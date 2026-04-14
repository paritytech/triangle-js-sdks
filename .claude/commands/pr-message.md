Create a Pull Request message for github.
Use dry simple language, but add code examples if necessary.
Use diff of current branch (execute `git rev-parse --abbrev-ref HEAD` to get current branch name) from $1 branch or main if input is not provided.
Output the message to the console with markdown formatting for copy-pasting.
Call `/copy` command after outputing the message.

ATTENTION: DO NOT CREATE ACTUAL PULL REQUESTS! JUST WRITE THE MESSAGE TO THE OUTPUT.
