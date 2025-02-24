const path = require('path')
const fs = require("fs-extra")
const spawn = require('child_process').spawn

const TAG = "WINSIGN"

/**
 * sign a given file either with a private key taken from a pkcs12 signing certificate
 * (if the path to the cert is given in the env var DEBUG_SIGN)
 * or with the HSM.
 *
 * argument names may be fixed by electron-builder
 */
function signer({
					path: pathToSign, // path to the file to sign (string)
					hash: hashAlgorithm // hash algorithm to use (string, defaults to "sha256")
				}) {
	const ext = path.extname(pathToSign)
	// /thing/thong.AppImage -> /thing/thong-unsigned.AppImage
	const unsignedFileName = pathToSign.slice(0, pathToSign.length - ext.length) + "-unsigned" + ext
	console.log(TAG, `signing ${unsignedFileName} as ${pathToSign}`)
	const commandArguments = process.env.DEBUG_SIGN
		? getSelfSignedArgs(unsignedFileName, hashAlgorithm, pathToSign)
		: getHsmArgs(unsignedFileName, hashAlgorithm, pathToSign)

	return signWithArgs(commandArguments, pathToSign, unsignedFileName)
}

function getSelfSignedArgs(unsignedFileName, hash, signedFileOutPath) {
	const certificateFile = path.join(process.env.DEBUG_SIGN, "test.p12")

	return [
		"sign",
		"-in", unsignedFileName,
		"-out", signedFileOutPath,
		"-pkcs12", certificateFile,
		"-h", hash ? hash : "sha256",
		"-t", "http://timestamp.comodoca.com/authenticode",
		"-n", "tutanota-desktop"
	]
}

function getHsmArgs(unsignedFileName, hash, signedFileOutPath) {
	const certificateFile = process.env["WIN_CSC_FILE"]
	const hsmPin = process.env["HSM_USER_PIN"]

	//  Timestamping:
	//  1. The client application creates a hashed value of the data to the timestamp server.
	// 	2. the timestamp server combines the hash and other information, including the authoritative time.
	// 	    The result is digitally signed with the TSA’s private key, creating a timestamp token which is sent back to the client.
	// 	    The timestamp token contains the information the client application will need to verify the timestamp later.
	// 	3. The timestamp token is received by the client application and recorded within the document or code signature.
	//  other timestamping services:
	//  http://timestamp.globalsign.com/scripts/timstamp.dll
	//  http://timestamp.comodoca.com/authenticode/authenticode
	//  http://www.startssl.com/timestamp
	//  http://timestamp.sectigo.com

	if (!certificateFile) {
		console.error("ERROR: " + signedFileOutPath.split(path.sep).pop() + "\" not signed! The NSIS installer may not work.")
		console.log("\t• set WIN_CSC_FILE env var")
		throw new Error(signedFileOutPath)
	}

	if (!hsmPin) {
		console.log("ERROR: " + signedFileOutPath.split(path.sep).pop() + "\" not signed! The NSIS installer may not work.")
		console.log("\t• set  HSM_USER_PIN env var")
		throw new Error(signedFileOutPath)
	}

	return [
		"sign",
		"-in", unsignedFileName,
		"-out", signedFileOutPath,
		// Let the library find the engine, it seems to be more reliable
		// "-pkcs11engine", "/usr/lib/x86_64-linux-gnu/engines-3/pkcs11.so",
		"-pkcs11module", "/usr/lib/x86_64-linux-gnu/opensc-pkcs11.so",
		"-certs", certificateFile,
		"-key", "11", // this is the key corresponding to the Windows authenticode codesigning certificate
		"-pass", hsmPin,
		"-h", hash ? hash : "sha256",
		"-t", "http://timestamp.comodoca.com/authenticode",
		"-n", "tutanota-desktop"
	]
}

function signWithArgs(commandArguments, signedFileOutPath, unsignedFileName) {
	const command = "/usr/bin/osslsigncode"

	if (!fs.existsSync(command)) {
		console.log(TAG, `ERROR: ${signedFileOutPath.split(path.sep).pop()}" not signed! The NSIS installer may not work.`)
		console.log("\t• install osslsigncode")
		return Promise.reject(new Error(signedFileOutPath))
	}
	console.log(TAG, `renaming ${signedFileOutPath} -> ${unsignedFileName}`)
	console.log(TAG, "ir:", fs.readdirSync(path.dirname(signedFileOutPath)).join(", "))
	fs.renameSync(signedFileOutPath, unsignedFileName)
	console.log(TAG, `running ${command}`)
	// only for testing, would print certificate password to logs, otherwise
	//console.log(`spawning "${command} ${commandArguments.join(" ")}"`)
	const child = spawn(command, commandArguments, {
		detached: false,
		stdio: ['ignore', 'inherit', 'inherit'],
	})

	return new Promise((resolve, reject) => {
		child.on('close', (exitCode) => {
			if (exitCode !== 0) {
				console.log(TAG, `signing FAILED with ${exitCode} for ${unsignedFileName} as ${signedFileOutPath}`)
				reject(exitCode)
			} else {
				console.log(TAG, `signing SUCCEDED for ${unsignedFileName} as ${signedFileOutPath}`)
				fs.unlinkSync(unsignedFileName)
				resolve(signedFileOutPath)
			}
		})
	})
}

module.exports = signer
