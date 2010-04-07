var sys = require("sys");
var url = require("url");
var qs = require("querystring");
var redis = require("./redisclient");
var fu = require("./fu");


// basic setup
HOST = null; //localhost
PORT = 3000;
fu.listen(PORT, HOST);
initialSetup();

// setup routes to files
fu.get("/", fu.staticHandler("index.html"));
fu.get("/main.css", fu.staticHandler("main.css"));
fu.get("/client.js", fu.staticHandler("client.js"));
fu.get("/jquery-1.2.6.min.js", fu.staticHandler("jquery-1.2.6.min.js"));

// lets client send message to server
fu.get("/send_message", function (req, res) {
	var message = qs.parse(url.parse(req.url).query).message;
	storeMessage(message);
	res.simpleJSON(200, {});
});

// returns latest message to client
fu.get("/latest_message", function (req, res) {
	var redisClient = new redis.Client();
	redisClient.lindex('messages', 0, function (err, value) {
		redisClient.close();
		res.simpleJSON(200, { message: value });
	});
});

// returns all messages sent to client
fu.get("/messages", function (req, res) {
	var redisClient = new redis.Client();
	redisClient.lrange('messages', 0, -1, function (err, value) {
		redisClient.close();
		messages = []
		for(var i in value)
			messages.unshift(value[i]);
			
		res.simpleJSON(200, { messages: messages });
	});
});

// returns true if send message already stored (already said)
fu.get("/unique_chalk", function (req, res) {
	var new_message = qs.parse(url.parse(req.url).query).message;
	
	var redisClient = new redis.Client();
	redisClient.lrange('messages', 0, -1, function (err, value) {
		redisClient.close();
		uniqueChalk = true;
		for(i in value)
			if(value[i] == new_message)
			{
				uniqueChalk = false;
				break;
			}
			
		res.simpleJSON(200, { message: uniqueChalk });
	});
});

// setup of initial message if required
function initialSetup() {
	var redisClient = new redis.Client();
	redisClient.exists('messages', function (err, value) {
		if(value == 0)
			storeMessage("We liked the same music, we liked the same bands, we liked the same clothes.");
	});
}

function storeMessage(message) {
	// put message in list and store it in quick access latest_message var
	var redisClient = new redis.Client();
	redisClient.lpush('messages', message, function (err, value) {
		redisClient.close();
	});
}