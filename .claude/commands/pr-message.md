Create a Pull Request message for github.
It should describe changes in a way the end user can understand — don't get deep into technical details.
Use dry, simple language, but add code examples if necessary.
Use the diff of the current branch (run `git rev-parse --abbrev-ref HEAD` to get the current branch name) against `$1`, or `main` if no argument is provided.
Output the message to the console with markdown formatting for copy-pasting.
Do not include a test plan or any other information that isn't relevant to the PR.
Copy this message to the clipboard.

ATTENTION: DO NOT CREATE ACTUAL PULL REQUESTS! JUST WRITE THE MESSAGE TO THE OUTPUT.
