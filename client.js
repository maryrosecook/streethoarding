$(window).load(function() {
	// put focus in text field
	$("input:visible:enabled:first").focus();
	
	// deal with input to text field
	$("#message_field").keypress(function (e) {
		if (e.keyCode != 13) /* Return */
			return;
			
		var message = $("#message_field").attr("value").replace("\n", "");
		if(util.isBlank(message)) // add condition to check for lameness
			sendMessage(message);
		
		$("#message_field").attr("value", ""); // clear the entry field.
	});

	longPoll(); // start up the long poller
});


function sendMessage(message) {
	jQuery.get("/send_message", {message: message}, function (data) { }, "json");
}

function updateMessage(message) {
	$("#posted_message").html(message);
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
						 }, 1000);
					 }
				 });
}


util = {
	isBlank: function(text) {
		var blank = /^\s*$/;
		return (text.match(blank) == null);
	}
}