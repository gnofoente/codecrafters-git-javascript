const { mkdirSync, writeFileSync } = require("node:fs");
const { readFile } = require("node:fs/promises");
const path = require("path");
const zlib = require("node:zlib");
const util = require("node:util");
const process = require("node:process");
const crypto = require("node:crypto");

const inflate = util.promisify(zlib.inflate);

const COMMANDS = {
  'init': () => {
    mkdirSync(path.join(__dirname, ".git"), { recursive: true});
    mkdirSync(path.join(__dirname, ".git", "objects"), { recursive: true});
    mkdirSync(path.join(__dirname, ".git", "refs"), { recursive: true});

    writeFileSync(path.join(__dirname, ".git", "HEAD"), "ref: refs/heads/main\n");
    console.log("Initialized git directory");
  },

  'cat-file': () => {
    const hash = process.argv[4];
    const hashAsArray = hash.split('');
    const dir = hashAsArray.slice(0, 2).join('');
    const fileName = hashAsArray.slice(2).join('');

    readFile(`./.git/objects/${dir}/${fileName}`)
    .then(buffer => {
      return inflate(buffer)
    })
    .then(buffer => {
      const str = buffer.toString('utf-8');
      const [header, fileContent] = str.split('\x00');
      process.stdout.write(fileContent);
    })
    .catch(reason => { throw reason; })
  },

  'hash-object': () => {
    const shouldWrite = process.argv.includes('-w');
    const fileToHash = process.argv[4];

    readFile(`./${fileToHash}`)
    .then(buffer => {
      const fileContents = buffer.toString('utf-8');
      const hash = crypto.createHash('sha1');
      const object = `blob ${fileContents.length}\0${fileContents}`;

      hash.update(object);
      const objectHash = hash.digest('hex');

      const dir = objectHash.slice(0, 2);
      const fileName = objectHash.slice(2);

      const objPath = path.join(__dirname, '.git', 'objects');

      mkdirSync(path.join(objPath, dir));

      zlib.deflate(object, (error, result) => {
        if (error) throw error;
        writeFileSync(path.join(objPath, dir, fileName), result);
        process.stdout.write(objectHash);
      });
    });
  }
}

const command = process.argv[2];
let onCommand = COMMANDS[command];
if (!onCommand) throw new Error(`Invalid command ${command}`);
onCommand();

