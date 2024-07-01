const { 
  mkdirSync, 
  writeFileSync,
  readdirSync,
  readFileSync 
} = require("node:fs");
const { readFile } = require("node:fs/promises");
const path = require("path");
const zlib = require("node:zlib");
const util = require("node:util");
const process = require("node:process");
const crypto = require("node:crypto");
const https = require("node:https");

const inflate = util.promisify(zlib.inflate);

const IGNORE = [
  '.git',
  '.gitattributes',
  'main.js'
];

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

    const filePath = path.join(
      ".git",
      "objects",
      dir,
      fileName
    );

    readFile(filePath)
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

    readFile(path.join(fileToHash))
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
  },

  'ls-tree': () => {
    // get the tree SHA from command args
    const treeSHA = process.argv[4];

    // try to find a git object file with the specified SHA
    const treeDirName = treeSHA.slice(0, 2);
    const treeFileName = treeSHA.slice(2);
    const filePath = path.join(
      __dirname, 
      ".git", 
      "objects", 
      treeDirName,
      treeFileName
    );

    // open the git object file
    readFile(filePath)
    .then(buffer => {
      return inflate(buffer);
    })
    .then(buffer => {
      // get all objects inside the tree file
      // print the objects' names to stdout
      console.log(getTreeStructureFromBuffer(buffer));
    })
    .catch(reason => { throw reason; });
  },

  'write-tree': () => {
    const treeHash = writeTree(__dirname);
    process.stdout.write(treeHash);
  },

  'commit-tree': () => {
    const treeSHA = process.argv[3];
    const parentCommitSHA = process.argv.slice(process.argv.indexOf('-p'), process.argv.indexOf('-p')+2)[1];
    const message = process.argv.slice(process.argv.indexOf('-m'), process.argv.indexOf('-m')+2)[1];

    const commitContentBuffer = Buffer.concat([
      Buffer.from(`tree ${treeSHA}\n`),
      Buffer.from(`parent ${parentCommitSHA}\n`),
      Buffer.from(`author The Commiter <thecommitter@test.com> ${Date.now} +0000\n`),
      Buffer.from(`commiter The Commiter <thecommitter@test.com> ${Date.now} +0000\n\n`),
      Buffer.from(`${message}\n`)
    ]);

    const commitBuffer = Buffer.concat([
      Buffer.from(`commit ${commitContentBuffer.length}\0`),
      commitContentBuffer
    ]);

    const commitHash = generateHash(commitBuffer);
    const compressedCommit = zlib.deflateSync(commitBuffer);
    
    const dir = commitHash.slice(0, 2);
    const fileName = commitHash.slice(2);
    const commitDir = path.resolve(__dirname, '.git', 'objects', dir);
    
    mkdirSync(commitDir, { recursive: true });
    writeFileSync(path.resolve(commitDir, fileName), compressedCommit);
    
    process.stdout.write(commitHash);
  },

  'clone': () => {
    const repositoryURL = process.argv[3];
    const dir = process.argv[4] || __dirname;

    console.log(`CLONING ${repositoryURL} into ${dir}`);
    const options = {
      method: 'GET'
    };

    const req = https.request(`${repositoryURL}/info/refs?service=git-upload-pack`, options, (res) => {
      res.on("data", (data) => {
        console.log(data.toString('utf-8'));
      });
    });

    req.on("error", (e) => {
      console.log(e);
    });

    req.end();
  }
}

const command = process.argv[2];
let onCommand = COMMANDS[command];
if (!onCommand) throw new Error(`Invalid command ${command}`);
onCommand();

function getTreeStructureFromBuffer(buffer) {
  const firstNullByteIndex = buffer.indexOf('\x00');
  const bufferWithoutHeader = buffer.slice(firstNullByteIndex + 1);
  const str = bufferWithoutHeader.toString('utf-8');
  let lines = str.split(/([0-9]{5,6})/);
  lines = lines
    .filter(line => {
      return line.startsWith(' ');
    })
    .map(line => {
      const nullByteIndex = line.indexOf('\x00'); 
      const name = line.slice(0, nullByteIndex).trim();
      return name;
    })
    .join('\n');
  return lines;
}

function writeTree(directoryPath) {
  const entries = readdirSync(directoryPath, { withFileTypes: true }).filter(entry => !IGNORE.includes(entry.name));

  const treeEntries = [];

  for (entry of entries) {
    if (entry.isFile()) {
      treeEntries.push({
        mode: 100644,
        name: entry.name,
        hash: writeFileObject(path.join(directoryPath, entry.name))
      });
    } else {
      treeEntries.push({
        mode: 40000,
        name: entry.name,
        hash: writeTree(entry.name)
      })
    }
  }
  
  let entriesBuffer = Buffer.alloc(0);

  for (entry of treeEntries) {
    entriesBuffer = Buffer.concat([
      entriesBuffer,
      Buffer.from(`${entry.mode} ${entry.name}\0`),
      Buffer.from(entry.hash, 'hex')
    ])
  }

  const treeBuffer = Buffer.concat([
    Buffer.from(`tree ${entriesBuffer.length}\x00`),
    entriesBuffer
  ]);

  const compressedTree = zlib.deflateSync(treeBuffer);
  const treeHash = generateHash(treeBuffer);
  const dir = treeHash.slice(0, 2);
  const fileName = treeHash.slice(2);

  mkdirSync(path.resolve(directoryPath, '.git', 'objects', dir), { recursive: true });
  writeFileSync(path.resolve(directoryPath, '.git', 'objects', dir, fileName), compressedTree);
  return treeHash;
}

function writeFileObject(filePath) {
  const fileContents = readFileSync(filePath, { encoding: 'utf-8' });
  const blobContent = `blob ${fileContents.length}\0${fileContents}`;
  const hash = generateHash(blobContent);

  const dir = hash.slice(0, 2);
  const fileName = hash.slice(2);
  const objPath = path.join(__dirname, '.git', 'objects');
  const compressedFile = zlib.deflateSync(blobContent);

  mkdirSync(path.join(objPath, dir));
  writeFileSync(path.join(objPath, dir, fileName), compressedFile);

  return hash;
}

function generateHash(content) {
  const hash = crypto.createHash('sha1');
  hash.update(content);
  return hash.digest('hex');
}