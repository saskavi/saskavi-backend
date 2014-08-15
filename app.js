// app.js
// Saskavi deploy manager
//


var docker = require('dockerode');
var targz = require('tar.gz');
var uuid = require('node-uuid');

var path = require('path');
var fs = require('fs');


(function() {
	"use strict";

	var ferb = require("ferb")();
	var debug = require("debug")("saskavi:deloy");
	var Docker = require("dockerode");

	var docker = new Docker({
		protocol: 'http',
		host: '192.168.59.103',
		port: 2375
	});


	var extractStream = function(stream, cb) {
		var staging = '/tmp';
		var filecode = 'saskavi-deploy-' + uuid.v4();

		var file = path.join(staging, filecode + '.tar.gz');

		// TODO: For large deployments this is not scalable.
		var body = new Buffer(0);
		stream.on('data', function(chunk) {
			body = Buffer.concat([body, chunk]);
		});

		stream.on('end', function() {
			fs.writeFile(file, body, function(err) {
				if (err)
					return cb(err);

				var outdir = '/tmp/staged-' + filecode;
				var compress = new targz().extract(file, outdir, function() {
					fs.unlink(file, function() {
						debug("deployment archive unlinked.");
					});

					if(err)
						cb(err);

					fs.readdir(outdir, function(err, files) {
						if (err || files.length === 0)
							return cb(err || new Error("No files in payload?"));

						cb(null, path.join(outdir, files[0]));
					});
				});
			});
		});
	};

	ferb.post("/deploy", function(req, res) {
		extractStream(req, function(err, dirname) {
			if (err)
				return res.json(500, {status: false, message: err.message});

			debug("Mounting", dirname, "as docker instance");

			docker.listContainers(function(err, containers) {
				console.log(err, containers);
			});

			res.json({status: true});
		});
	});

	ferb.listen(16000, function() {
		debug("Server is now listening for deploy requests");
	});
})();
