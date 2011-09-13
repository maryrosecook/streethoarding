var sys = require("sys");
var url = require("url");
var qs = require("querystring");
var fu = require("./fu");

// basic setup
HOST = null; //localhost
PORT = process.env.PORT || 3000;
var redisClient = makeRedisClient();
var messageRequests = []
fu.listen(PORT, HOST);
initialSetup();

// setup routes to files
fu.get("/", fu.staticHandler("index.html"));
fu.get("/main.css", fu.staticHandler("main.css"));
fu.get("/client.js", fu.staticHandler("client.js"));
fu.get("/jquery-1.2.6.min.js", fu.staticHandler("jquery-1.2.6.min.js"));

// lets client send message to server
var latestMessageReceived = new Date().getTime();
fu.get("/send_message", function (req, res) {
  var message = qs.parse(url.parse(req.url).query).message;
  storeMessage(message, function() {
    res.simpleJSON(200, {});
		latestMessageReceived = new Date().getTime();

		// respond to queued message requests from clients now that we have a new message to send out
		while (messageRequests.length > 0)
		{
			var messageRequest = messageRequests.shift();
			messageRequest.callback(messageRequest.res);
		}
  });
});

// put message in list and store it in quick access latest_message var
function storeMessage(message, callback) {
	  redisClient.lpush('messages', message, function (err, value) {
	    callback();
	  });
}

// if new message available for client, return it immediately,
// or queue request to be dealt with next time new message comes in
fu.get("/latest_message", function (req, res) {
	var since = parseInt(qs.parse(url.parse(req.url).query).since);

	if(since < latestMessageReceived) // new message since client last requested
    sendLatestMessageToClient(res); // send it straight to them
  else
    messageRequests.push({ callback: sendLatestMessageToClient, res: res }); // queue up the requst
});

// retrieves latest message and sends it to user
function sendLatestMessageToClient(res) {
		redisClient.lindex('messages', 0, function (err, value) {
			res.simpleJSON(200, { message: value.toString(), timestamp: new Date().getTime() });
		});
}

// returns true if send message already stored (already said)
fu.get("/unique_chalk", function (req, res) {
	var new_message = qs.parse(url.parse(req.url).query).message;

		redisClient.lrange('messages', 0, -1, function (err, value) {
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
    	redisClient.exists('messages', function (err, value) {
    		if(value == 0)
    		{
    			storeMessage("We liked the same music, we liked the same bands, we liked the same clothes.", function() {
    		    res.simpleJSON(200, {});
    		  });
    		}
    	});
}

function makeRedisClient() {
  if(process.env.REDISTOGO_URL)
  {
    var rtg = require("url").parse(process.env.REDISTOGO_URL);
    var redis = require("redis").createClient(rtg.port, rtg.hostname);
    console.log(rtg.port, rtg.hostname, rtg.auth.split(":")[1])
    redis.auth(rtg.auth.split(":")[1]);
    return redis;
  }
  else
    return require("redis").createClient();
};