const fs = require("fs");
const path = require("path");

// You can use print statements as follows for debugging, they'll be visible when running tests.
console.log("Logs from your program will appear here!");

const COMMANDS = {
  'init': () => {
    fs.mkdirSync(path.join(__dirname, ".git"), { recursive: true});
    fs.mkdirSync(path.join(__dirname, ".git", "objects"), { recursive: true});
    fs.mkdirSync(path.join(__dirname, ".git", "refs"), { recursive: true});

    fs.writeFileSync(path.join(__dirname, ".git", "HEAD"), "ref: refs/heads/main\n");
    console.log("Initialized git directory");
  }
}

const command = process.argv[2];
let onCommand = COMMANDS[command];
if (!onCommand) throw new Error(`Invalid command ${command}`);
onCommand();

