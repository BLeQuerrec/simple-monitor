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
async.each(config, function(server, callback){
	if (typeof server.name != "string" || server.ipv4 === undefined || server.ipv6 === undefined){
		console.log('Error: Cannot parse config.json.');
		process.exit(1);
	}
	if (server.disclose_addresses === undefined) server.disclose_addresses = false;
	if (server.ping === undefined) server.ping = true;
	if (server.on_error === undefined) server.on_error = {};
	if (server.on_error.webhook === undefined) server.on_error.webhook = [];
	if (server.on_error.email === undefined) server.on_error.email = [];
	if (server.services === undefined) server.services = [];
	for (var n in server.services){
		if (typeof server.services[n].name != "string" || typeof server.services[n].port != "number"){
			console.log('Error: Cannot parse config.json.');
			process.exit(1);
		}
	}
});

if (process.env.SMTP_HOSTNAME === undefined || process.env.SMTP_USERNAME === undefined || process.env.SMTP_PASSWORD === undefined || process.env.SMTP_FROM === undefined){
	console.log("Warning: email hook is not configured.");
	var email = false;
}
else {
	var email = true;
}

var writeCache = function(server, test, status){
	fs.writeFile("cache/cache."+server+"."+test, status, function(err) {});
}

var update = function(){
	async.each(config, function(server, callback){
		if (server.ping === true){
			if (server.ipv4 !== false){
				require('child_process').exec('ping -c 1 -w 1 "'+server.ipv4.replace('"', '\\"')+'"', function(err, stdout){
					if (stdout.indexOf(' 0% packet loss') < 0){
						writeCache(server.name, "ping.ipv4", "down");
					}
					else {
						writeCache(server.name, "ping.ipv4", "up");
					}
				});
			}
			if (server.ipv6 !== false){
				require('child_process').exec('ping6 -c 1 -w 1 "'+server.ipv6.replace('"', '\\"')+'"', function(err, stdout){
					if (stdout.indexOf(' 0% packet loss') < 0){
						writeCache(server.name, "ping.ipv6", "down");
					}
					else {
						writeCache(server.name, "ping.ipv6", "up");
					}
				});
			}
		}
		if (server.ipv4 !== false){
			async.each(server.services, function(service, callback){
				var client = net.connect({host: server.ipv4, port: service.port});
				client.setTimeout(3000);
				client.on('connect', function() {
					writeCache(server.name, service.name+".ipv4", "up");
					client.end();
				});
				client.on('timeout', function() {
					writeCache(server.name, service.name+".ipv4", "timeout");
					client.end();
				});
				client.on('error', function(err) {
					writeCache(server.name, service.name+".ipv4", "down");
					client.end();
				});
			});
		}
		if (server.ipv6 !== false){
			async.each(server.services, function(service, callback){
				var client = net.connect({host: server.ipv6, port: service.port});
				client.setTimeout(3000);
				client.on('connect', function() {
					writeCache(server.name, service.name+".ipv6", "up");
					client.end();
				});
				client.on('timeout', function() {
					writeCache(server.name, service.name+".ipv6", "timeout");
					client.end();
				});
				client.on('error', function(err) {
					writeCache(server.name, service.name+".ipv6", "down");
					client.end();
				});
			});
		}
	});
};

var get = function(end){
	async.map(config, function(server, callback){
		if (server.ping === true){
			var ping = {};
			if (server.ipv4 !== false) ping.ipv4 = fs.readFileSync("cache/cache."+server.name+".ping.ipv4", "utf8");
			if (server.ipv6 !== false) ping.ipv6 = fs.readFileSync("cache/cache."+server.name+".ping.ipv6", "utf8");
		}
		async.map(server.services, function(service, next){
			var state = {};
			if (server.ipv4 !== false) state.ipv4 = fs.readFileSync("cache/cache."+server.name+"."+service.name+".ipv4", "utf8");
			if (server.ipv6 !== false) state.ipv6 = fs.readFileSync("cache/cache."+server.name+"."+service.name+".ipv6", "utf8");
			return next(null, state);
		}, function (err, services){
			return callback(null, {ping: ping, services: services});
		});
	}, function(err, status){
		return end(status);
	});
};

var parseHooks = function(server, ip, service, status){
	server.on_error.webhook.forEach(function(entry) {
		var webhook = entry.replace('{server}', server.name).replace('{ip}', ip).replace('{service}', service).replace('{status}', status);
		request.get(webhook).on('error', function(err){
			console.log('Cannot execute webhook', webhook, err);
		});
	});
	if (email === true){
		server.on_error.email.forEach(function(entry) {
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
				subject: "[ALERT] Error on "+server.name,
				text: "Hi,\n\nThe following service is down:\n\nServer: "+server.name+" ("+ip+")\nService: "+service+"\nStatus: "+status+"\n\n---\nThe bot."
			}, function(err){
				if(err) console.log('Cannot send email to '+entry+':', err);
			});
		});
	}
};

var hooks = function(){
	async.each(config, function(server, callback){
		if (server.ping === true){
			if (server.ipv4 !== false){
				if (fs.readFileSync("cache/cache."+server.name+".ping.ipv4", "utf8") == "down"){
					parseHooks(server, "ipv4", "ping", "down");
				}
			}
			if (server.ipv6 !== false){
				if (fs.readFileSync("cache/cache."+server.name+".ping.ipv6", "utf8") == "down"){
					parseHooks(server, "ipv6", "ping", "down");
				}
			}
		}
		for (var n in server.services){
			if (server.ipv4 !== false){
				var status = fs.readFileSync("cache/cache."+server.name+"."+server.services[n].name+".ipv4", "utf8");
				if (status != "up"){
					parseHooks(server, "ipv4", server.services[n].name, status);
				}
			}
			if (server.ipv6 !== false){
				var status = fs.readFileSync("cache/cache."+server.name+"."+server.services[n].name+".ipv6", "utf8");
				if (status != "up"){
					parseHooks(server, "ipv6", server.services[n].name, status);
				}
			}
		}
	});
};

var app = express();

app.use(express.static(__dirname + '/assets'));
app.set('view engine', 'ejs');

app.get('/', function (req, res) {
	get(function(status){
		return res.render('index', {req: req, res: res, config: config, status: status});
	})
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
