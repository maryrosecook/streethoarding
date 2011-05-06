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
	$("#countdown").html(i.toString());
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

	return errorMessage;
}

var transmission_errors = 0;
var lastMessageReceived = 0; // a long time ago
function longPoll (data) {
	if (data && data.message) {
		updateMessage(data.message);
		lastMessageReceived = new Date().getTime();
	}

	$.ajax({ cache: false,
				 	 type: "GET",
				 	 url: "/latest_message",
				 	 dataType: "json",
					 data: { since: lastMessageReceived },
				 	 error: function () {
						 transmission_errors += 1;
						 setTimeout(longPoll, 1);
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
	MAX_LENGTH: 77,

	isTooLong: function(text) {
		return text.length > this.MAX_LENGTH;
	}
}

// removes all nav and replaces it with a home/cancel link
function switchToNonInteractiveMode() {
	$("#cancel").show();
	$("#credits").hide();
	$("#message_entry_area").hide();
}

function credits() {
	switchToNonInteractiveMode();
	updateMessage("<a href='http://github.com/maryrosecook/streethoarding'>Code</a> by <a href='http://maryrosecook.com'>maryrosecook</a>, based on <a href='http://chat.nodejs.org/'>chat</a> by <a href='http://github.com/ry'>Ryan</a>.");
}