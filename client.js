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

function isGhostChalk(message) {
}

function updateMessage(message) {
	$("#posted_message").html(message);
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
	if (transmission_errors > 2) {
		showConnect();
		return;
	}

	if (data && data.message && prevMessage != data.message) {
		updateMessage(data.message);
		prevMessage = data.message;
	}

	$.ajax({ cache: false
				 , type: "GET"
				 , url: "/latest_message"
				 , dataType: "json"
				 , error: function () {
						 transmission_errors += 1;
						 setTimeout(longPoll, 10*1000);
					 }
				 , success: function (data) {
						 transmission_errors = 0;
						 setTimeout(function () {
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
	stupid: ["cock", "fag"],
	diez: ["a team"],
	MAX_LENGTH: 77,
	
	isTooLong: function(text) {
		return text.length > this.MAX_LENGTH;
	}
}