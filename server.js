var fu = require("./fu");
var sys = require("sys");
var url = require("url");
var qs = require("querystring");

HOST = null;
PORT = 3000;
fu.listen(PORT, HOST);

firstMessage = "We liked the same music, we liked the same bands, we liked the same clothes.";
var messages = [firstMessage];

fu.get("/", fu.staticHandler("index.html"));
fu.get("/main.css", fu.staticHandler("main.css"));
fu.get("/client.js", fu.staticHandler("client.js"));
fu.get("/jquery-1.2.6.min.js", fu.staticHandler("jquery-1.2.6.min.js"));


fu.get("/send_message", function (req, res) {
	var message = qs.parse(url.parse(req.url).query).message;
	sys.puts(message);
	messages.push(message);
	res.simpleJSON(200, {});
});

fu.get("/latest_message", function (req, res) {
	res.simpleJSON(200, { message: messages[messages.length-1] });
});