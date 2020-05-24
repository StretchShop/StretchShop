const path = require("path");
const childProcess = require("child_process");
const fs = require("fs");
const { COPYFILE_EXCL } = fs.constants;
const ncp = require("ncp").ncp;

let args = process.argv;
let changePath = "";
if (args && args[2]=="base") {
	changePath = "../../";
}

function runScript(scriptPath, callback) {
	// keep track of whether callback has been invoked to prevent multiple invocations
	let invoked = false;
	let process = childProcess.fork(scriptPath);

	// listen for errors as they may prevent the exit event from firing
	process.on("error", function (err) {
		if (invoked) return;
		invoked = true;
		console.error("runScript err:", err);
		callback(err);
	});

	// execute the callback once the process has finished running
	process.on("exit", function (code) {
		if (invoked) return;
		invoked = true;
		let err = code === 0 ? null : new Error("exit code " + code);
		callback(err);
	});
}

console.log("Checking paths: \n", 
	"./" +changePath+ "public: ", fs.existsSync("./" +changePath+ "public") , "\n", 
	"./" +changePath+ "resources: ", fs.existsSync("./" +changePath+ "resources") , "\n", 
	"./" +changePath+ "services: ", fs.existsSync("./" +changePath+ "services")
);

if ( !fs.existsSync("./" +changePath+ "public") || 
		!fs.existsSync("./" +changePath+ "resources") || 
		!fs.existsSync("./" +changePath+ "services") ) {
	// 1. clone repository with demo data
	// 1.1 get target directory
	// from https://stackoverflow.com/questions/57669037/how-to-clone-github-repo-using-node-js/57669219#57669219
	let dir = __dirname+ "/repo";
	let repoUrl = "https://github.com/Wradgio/StretchShop-demo-data.git";
	if (!fs.existsSync(dir)){
		console.log("Creating repository folder in "+dir);
		fs.mkdirSync(dir);
		// 1.2 clone repository in target directory
		console.log("Cloning " +repoUrl+ " into " +dir);
		childProcess.execSync("git clone " +repoUrl+ " " +dir, {
			stdio: [0, 1, 2], // we need this so node will print the command output
			cwd: path.resolve(dir, ""), // path to where you want to save the file
		});
	}

	// 2. run code to fill in database
	// from https://stackoverflow.com/questions/22646996/how-do-i-run-a-node-js-script-from-within-another-node-js-script/22649812#22649812
	// 2.1 create vars and wrapper function for calling script
	let demoDataScriptFile = dir+ "/db/demo_data.js";
	if (changePath==="") {
		// 2.2. Now we can run a script and invoke a callback when complete
		runScript(demoDataScriptFile, function (err) {
			if (err) {
				console.error("Cannot run script "+demoDataScriptFile+" - error: ", err);
				return;
			}
			console.log("Finished running "+demoDataScriptFile);
		});
	}

	// 3. copy files from public and resources if they don't exists
	let options = { clobber: false };
	let syncPairs = [
		{
			source: dir+ "/public",
			destination: "./" +changePath+ "public"
		}, 
		{
			source: dir+ "/resources",
			destination: "./" +changePath+ "resources"
		}, 
		{
			source: dir+ "/services",
			destination: "./" +changePath+ "services"
		}
	];
	if (changePath!="") {
		let baseSyncFiles = [
			{
				source: dir+ "/../../moleculer.config.js",
				destination: "./" +changePath+ "moleculer.config.js"
			}, 
			{
				source: dir+ "/../../package.json",
				destination: "./" +changePath+ "package.json"
			}, 
			{
				source: dir+ "/../../.env.example",
				destination: "./" +changePath+ ".env"
			}, 
		];
		baseSyncFiles.forEach(function(pair){
			console.log("DIR: Trying to place " +pair.source+ " into " +pair.destination+ " - if not exists.");
			fs.copyFile(pair.source, pair.destination, COPYFILE_EXCL, (err) => {
				if (err) {
					console.error("Cannot copy " +pair.source+ " into " +pair.destination+ " - error: ", err);
					return;
				}
				console.log("FILE: Placed " +pair.source+ " into " +pair.destination+ ".");
			});
		});
	}
	ncp.limit = 16;
	syncPairs.forEach(function(pair){
		console.log("DIR: Trying to place " +pair.source+ " into " +pair.destination+ " - if not exists.");
		ncp(pair.source, pair.destination, options, function (err) {
			if (err) {
				return console.error(err);
			}
			console.log("DIR: Placed " +pair.source+ " into " +pair.destination+ ".");
		});
	});
}
