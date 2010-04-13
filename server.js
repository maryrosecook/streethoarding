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
  storeMessage(message, function() {
    res.simpleJSON(200, {});
  });
});

// put message in list and store it in quick access latest_message var
function storeMessage(message, callback) {
  var redisClient = new redis.createClient();
	redisClient.stream.addListener("connect", function () {
	  redisClient.lpush('messages', message, function (err, value) {
	    redisClient.close();
	    callback();
	  });
	});
}

// returns latest message to client
fu.get("/latest_message", function (req, res) {
	var redisClient = new redis.createClient();
	redisClient.stream.addListener("connect", function () {
		redisClient.lindex('messages', 0, function (err, value) {
			res.simpleJSON(200, { message: value.toString() });
			redisClient.close();
		});
	});
});


// returns true if send message already stored (already said)
fu.get("/unique_chalk", function (req, res) {
	var new_message = qs.parse(url.parse(req.url).query).message;
	
	var redisClient = new redis.createClient();
	redisClient.stream.addListener("connect", function () {
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
});

// setup of initial message if required
function initialSetup() {
	var redisClient = new redis.createClient();
	redisClient.stream.addListener("connect", function () {
		redisClient.exists('messages', function (err, value) {
			if(value == 0)
			{
				storeMessage("We liked the same music, we liked the same bands, we liked the same clothes.", function() {
			    res.simpleJSON(200, {});
			  });
			}
			redisClient.close();
		});
	});
}