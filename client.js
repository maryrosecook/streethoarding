$(window).load(function() {
	// put focus in text field
	$("input:visible:enabled:first").focus();
	
	// deal with input to text field
	$("#message_field").keypress(function (e) {
		if (e.keyCode != 13) /* Return */
			return;
			
		var message = $("#message_field").attr("value").replace("\n", "");
		var errorMessage = clientValid(message);
		if(errorMessage === null)
			tryToSendMessage(message);
		else
			updateErrorMessage(errorMessage);
	});

	// if mouse moves and replaying, update displayed messages
	$('body').mousemove(function(event) {
	  if(replaying === true)
		{
			replayMessageI = selectReplayMessageI(event);
			updateCountdown(replayMessageI);
			updateMessage(messages[replayMessageI]);
		}
	});

	longPoll(); // start up the long poller
});

// if server says message is unique, sends message to server; otherwise, shows error
function tryToSendMessage(message) {
	jQuery.get("/unique_chalk",
						 	{ message: message },
							function (data) {
								if(data && data.message) {
									jQuery.get("/send_message", { message: message }, function (data) {} , "json");
									updateErrorMessage(""); // blank out error
									$("#message_field").attr("value", ""); // clear the entry field.
								}
								else
									updateErrorMessage("said before");
							}, "json");
}

function updateMessage(message) {
	$("#posted_message").html(message);
}

function updateCountdown(i) {
	$("#countdown").html(i);
}

function updateErrorMessage(message) {
	$("#error_message").html(message);
}

// returns true if message passes basic client-only checks
function clientValid(message) {
	var errorMessage = null;
	if(util.isBlank(message))
		errorMessage = "";
	else if(v.isTooLong(message))
		errorMessage = "tooo long";
	else if(util.isBasically(v.stupid, message))
		errorMessage = "be more original";
	else if(util.isBasically(v.diez, message))
		errorMessage = "oh, for Christ's sake";
		
	return errorMessage;
}

var transmission_errors = 0;
var prevMessage = "";
function longPoll (data) {
	if (transmission_errors > 2 || replaying === true) {
		return;
	}

	if (data && data.message && prevMessage != data.message) {
		updateMessage(data.message);
		prevMessage = data.message;
	}

	$.ajax({ cache: false,
				 	 type: "GET",
				 	 url: "/latest_message",
				 	 dataType: "json",
				 	 error: function () {
						 transmission_errors += 1;
						 setTimeout(longPoll, 10*1000);
					 },
				 	 success: function (data) {
						 setTimeout(function () {
							 transmission_errors = 0;
							 longPoll(data);
						 }, 100);
					 }
				 });
}

util = {
	isBlank: function(text) {
		var blank = /^\s*$/;
		return (text.match(blank) !== null);
	},
	
	trim: function(str) {
		return str.replace(/^\s+|\s+$/g,"");
	},
	
	isBasically: function(arr, text) {
		var is = false;
		text = this.trim(text).toLowerCase();
		text = text.replace(/\s/g, "spacespacespace").replace(/\W/g, "").replace(/spacespacespace/g, " ");
		for(var i in arr)
			if(text == arr[i])
			{
				is = true;
				break;
			}

		return is;
	}
}

v = {
	stupid: ["fag", "cock"],
	diez: ["a team"],
	MAX_LENGTH: 77,
	
	isTooLong: function(text) {
		return text.length > this.MAX_LENGTH;
	}
}

// removes all nav and replaces it with a home/cancel link
function switchNavToHomeLink() {
	$("#cancel").show();
	$("#replay_and_credits").hide();
}

var replaying = false;
var messages = null;
// calls server to get all messages up to now, displays each one
function replaySetup() {
	replaying = true;
	currentReplayMessageI = 0;
	if(messages == null)
	{
		switchNavToHomeLink();
		$.ajax({ cache: false,
					 	 type: "GET",
					 	 url: "/messages",
					 	 dataType: "json",
					 	 error: function () {},
					   success: function (data) {
							 messages = [];
							 allMessages = data.messages;
							 for(var i in allMessages)
							 	 if(replayable(allMessages[i]))
									 messages.push(allMessages[i]);
						 }
					 });
	}
}

var prevX = 0;
var prevTime = -1;
var currentReplayMessageI = 0;
// decides what message should be replayed, based on where the mouse is
// goes through messages faster if mouse moved faster
function selectReplayMessageI(event) {
	// work out how much time has passed since last measured position of mouse
	var curTime = new Date().getTime()
	if(prevTime === -1) // if haven't recorded a prev time, just set it to now
		prevTime = curTime;
	
	var multiplier = 8;
	var scaler = messages.length / $(window).width(); // factor in num messages and window width
	var speedFactor = Math.pow((1 / (curTime - prevTime)) * multiplier * scaler, 3);
	
	var change = (event.pageX - prevX) * speedFactor;
	if(change > 0)
		change = Math.ceil(change);
	else
		change = Math.floor(change);

	currentReplayMessageI += change;
	
	if(currentReplayMessageI < 0)
		currentReplayMessageI = 0;
	else if(currentReplayMessageI >= messages.length - 1)
		currentReplayMessageI = messages.length - 1;
		
	prevTime = curTime;
	prevX = event.pageX;
	return currentReplayMessageI;
}

// returns true if this message will probably not fuck up the site
function replayable(message) {
	if(message == null)
		return false;
	else if(message.match(/alert/) !== null)
		return false;
	else if(message.match(/location/) !== null)
	  return false;
	else if(message.match(/document/) !== null)
		return false;
	else if(message.match(/while/) !== null)
		return false;
	else if(message.match(/tryToSendMessage/) !== null)
		return false;
	else if(message.match(/posted_message/) !== null)
		return false;
	else
		return true;
}

function credits() {
	switchNavToHomeLink();
	updateMessage("<a href='http://github.com/maryrosecook/streethoarding'>Code</a> by <a href='http://maryrosecook.com'>maryrosecook</a>, based on <a href='http://chat.nodejs.org/'>chat</a> by <a href='http://github.com/ry'>Ryan</a>.");
}