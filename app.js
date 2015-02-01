var express = require('express'),
	fs = require('fs'),
	net = require('net'),
	async = require('async'),
	request = require('request'),
	nodemailer = require('nodemailer'),
	smtpTransport = require('nodemailer-smtp-transport');

if (fs.existsSync('./config.json')) {
	var config = require('./config.json');
} else {
	var config = require('./config.example.json');
}

// Parse configuration file
for (var i in config){
	if (typeof config[i].name != "string" || config[i].ipv4 === undefined || config[i].ipv6 === undefined){
		console.log('Error: Cannot parse config.json.');
		process.exit(1);
	}
	if (config[i].disclose_addresses === undefined) config[i].disclose_addresses = false;
	if (config[i].ping === undefined) config[i].ping = true;
	if (config[i].on_error === undefined) config[i].on_error = {};
	if (config[i].on_error.webhook === undefined) config[i].on_error.webhook = [];
	if (config[i].on_error.email === undefined) config[i].on_error.email = [];
	if (config[i].services === undefined) config[i].services = [];
	for (var n in config[i].services){
		if (typeof config[i].services[n].name != "string" || typeof config[i].services[n].port != "number"){
			console.log('Error: Cannot parse config.json.');
			process.exit(1);
		}
	}
}

if (process.env.SMTP_HOSTNAME === undefined || process.env.SMTP_USERNAME === undefined || process.env.SMTP_PASSWORD === undefined || process.env.SMTP_FROM === undefined){
	console.log("Warning: email hook is not configured.");
	var email = false;
}
else {
	var email = true;
}

var writeCache = function(serverID, test, status){
	fs.writeFile("cache/cache."+config[serverID].name+"."+test, status, function(err) {});
}

var update = function(){
	for (var i in config){
		if (config[i].ping === true){
			if (config[i].ipv4 !== false){
				require('child_process').exec('ping -c 1 -w 1 "'+config[i].ipv4.replace('"', '\\"')+'"', function(err, stdout){
					if (stdout.indexOf(' 0% packet loss') < 0){
						writeCache(i, "ping.ipv4", "down");
					}
					else {
						writeCache(i, "ping.ipv4", "up");
					}
				});
			}
			if (config[i].ipv6 !== false){
				require('child_process').exec('ping6 -c 1 -w 1 "'+config[i].ipv6.replace('"', '\\"')+'"', function(err, stdout){
					if (stdout.indexOf(' 0% packet loss') < 0){
						writeCache(i, "ping.ipv6", "down");
					}
					else {
						writeCache(i, "ping.ipv6", "up");
					}
				});
			}
		}
		if (config[i].ipv4 !== false){
			async.each(config[i].services, function(service, callback){
				var client = net.connect({host: config[i].ipv4, port: service.port});
				client.setTimeout(2000);
				client.on('connect', function() {
					writeCache(i, service.name+".ipv4", "up");
					client.end();
				});
				client.on('timeout', function() {
					writeCache(i, service.name+".ipv4", "timeout");
					client.end();
				});
				client.on('error', function(err) {
					writeCache(i, service.name+".ipv4", "down");
					client.end();
				});
			});
		}
		if (config[i].ipv6 !== false){
			async.each(config[i].services, function(service, callback){
				var client = net.connect({host: config[i].ipv6, port: service.port});
				client.setTimeout(2000);
				client.on('connect', function() {
					writeCache(i, service.name+".ipv6", "up");
					client.end();
				});
				client.on('timeout', function() {
					writeCache(i, service.name+".ipv6", "timeout");
					client.end();
				});
				client.on('error', function(err) {
					writeCache(i, service.name+".ipv6", "down");
					client.end();
				});
			});
		}
	}
};

var get = function(){
	var status = [];
	for (var i in config){
		var server = {ping: {}, services: []};
		if (config[i].ping === true){
			if (config[i].ipv4 !== false) server.ping.ipv4 = fs.readFileSync("cache/cache."+config[i].name+".ping.ipv4", "utf8");
			if (config[i].ipv6 !== false) server.ping.ipv6 = fs.readFileSync("cache/cache."+config[i].name+".ping.ipv6", "utf8");
		}
		for (var n in config[i].services){
			var service = [];
			if (config[i].ipv4 !== false) service.ipv4 = fs.readFileSync("cache/cache."+config[i].name+"."+config[i].services[n].name+".ipv4", "utf8");
			if (config[i].ipv6 !== false) service.ipv6 = fs.readFileSync("cache/cache."+config[i].name+"."+config[i].services[n].name+".ipv6", "utf8");
			server.services.push(service);
		}
		status.push(server);
	}
	return status;
};

var parseHooks = function(server, ip, service, status){
	config[server].on_error.webhook.forEach(function(entry) {
		var webhook = entry.replace('{server}', config[server].name).replace('{ip}', ip).replace('{service}', service).replace('{status}', status);
		request.get(webhook).on('error', function(err){
			console.log('Cannot execute webhook', webhook, err);
		});
	});
	if (email === true){
		config[server].on_error.email.forEach(function(entry) {
			nodemailer.createTransport(smtpTransport({
				host: process.env.SMTP_HOSTNAME,
				port: process.env.SMTP_PORT || 25,
				auth: {
					user: process.env.SMTP_USERNAME,
					pass: process.env.SMTP_PASSWORD
				},
				maxConnections: 5
			})).sendMail({
				from: process.env.SMTP_FROM,
				to: entry,
				subject: "[ALERT] Error on "+config[server].name,
				text: "Hi,\n\nThe following service is down:\n\nServer: "+config[server].name+" ("+ip+")\nService: "+service+"\nStatus: "+status+"\n\n---\nThe bot."
			}, function(err){
				if(err) console.log('Cannot send email to '+entry+':', err);
			});
		});
	}
};

var hooks = function(){
	for (var i in config){
		if (config[i].ping === true){
			if (config[i].ipv4 !== false){
				if (fs.readFileSync("cache/cache."+config[i].name+".ping.ipv4", "utf8") == "down"){
					parseHooks(i, "ipv4", "ping", "down");
				}
			}
			if (config[i].ipv6 !== false){
				if (fs.readFileSync("cache/cache."+config[i].name+".ping.ipv6", "utf8") == "down"){
					parseHooks(i, "ipv6", "ping", "down");
				}
			}
		}
		for (var n in config[i].services){
			if (config[i].ipv4 !== false){
				var status = fs.readFileSync("cache/cache."+config[i].name+"."+config[i].services[n].name+".ipv4", "utf8");
				if (status != "up"){
					parseHooks(i, "ipv4", config[i].services[n].name, status);
				}
			}
			if (config[i].ipv6 !== false){
				var status = fs.readFileSync("cache/cache."+config[i].name+"."+config[i].services[n].name+".ipv6", "utf8");
				if (status != "up"){
					parseHooks(i, "ipv6", config[i].services[n].name, status);
				}
			}
		}
	}
};

var app = express();

app.use(express.static(__dirname + '/assets'));
app.set('view engine', 'ejs');

app.get('/', function (req, res) {
	return res.render('index', {req: req, res: res, config: config, status: get()});
})

var server = app.listen(process.env.PORT || 3000, function () {
	update();
	setTimeout(function(){
		hooks();
	}, 5000); // 5 seconds
	setInterval(function(){
		update();
		setTimeout(function(){
			hooks();
		}, 5000); // 5 seconds
	}, 1000*60*5); // 5 minutes
	console.log('App listening at http://%s:%s', server.address().address, server.address().port);
})
