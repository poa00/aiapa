import fs from "fs/promises";
import * as fsSync from "fs";
import path from "path";
import { realpathSync } from "fs";
import { pathToFileURL } from "url";

import { randomInt } from "../utils.js";
import { Parser } from "json2csv";

export { resolve } from "path";

let UAs = [];

/**
 * @typedef {string} relativePath path relative to the cli.js file
 * @typedef {string} absolutePath path resolved with process.cwd()
 */

export function isImported(url) {
    return url === pathToFileURL(realpathSync(process.argv[1])).href;
}

/**
 * @param {absolutePath} filePath 
 * @param {fsSync.OpenMode} encoding 
 */
export async function loadFile(filePath, encoding = "utf-8") {
    return await fs.readFile(path.resolve(process.cwd(), filePath), encoding);
}

/**
 * @param {absolutePath} filePath 
 * @param {string | undefined} encoding 
 */
export function loadFileSync(filePath, encoding = "utf-8") {
    return fsSync.readFileSync(path.resolve(process.cwd(), filePath), encoding);
}

/**
 * @param {string} _path 
 * @returns {absolutePath}
 */
export function resolveFromCwd(_path) {
    return path.resolve(process.cwd(), _path);
}

export function joinPath(...paths) {
    return path.join(...paths);
}

/**
 * @param {absolutePath} dirPath 
 */
export async function createDirIfNotExists(dirPath) {
    if (!await directoryExists(dirPath)) {
        await fs.mkdir(path.resolve(process.cwd(), dirPath), { recursive: true });
    }
}

export async function saveFile(filePath, data, encoding = "utf-8") {
    await createDirIfNotExists(path.dirname(filePath));
    let _path = path.resolve(process.cwd(), filePath);
    await fs.writeFile(_path, data, encoding);
    return _path;
}

/**
 * @param {absolutePath} filePath 
 * @param {string} name 
 * @param {readonly any[] | Readonly<any>} data 
 * @param {import("json2csv").Options<any> | undefined} options 
 * @returns 
 */
export async function saveCSV(filePath, name, data, options = {}) {
    const savePath = path.join(process.cwd(), filePath, `${name}.csv`), csv = new Parser(options).parse(data);
    await saveFile(savePath, csv);
    return savePath;
}

export async function appendFile(filePath, data, encoding = "utf-8") {
    return await fs.appendFile(path.resolve(process.cwd(), filePath), data, encoding);
}

export async function deleteFile(filePath) {
    return await fs.unlink(path.resolve(process.cwd(), filePath));
}

export async function fileExists(filePath) {
    try {
        await fs.access(path.resolve(process.cwd(), filePath));
        return true;
    } catch (error) {
        return false;
    }
}

export async function directoryExists(dirPath) {
    try {
        await fs.access(path.resolve(process.cwd(), dirPath));
        return true;
    } catch (error) {
        return false;
    }
}

/**
 * @param {absolutePath} dirPath 
 * @returns {Promise<string[]>}
 */
export async function getFilesInDir(dirPath) {
    return await fs.readdir(path.resolve(process.cwd(), dirPath));
}

export async function clearDirectory(dirPath, whenDeleted = () => { }) {
    if (await directoryExists(dirPath)) {
        const files = await fs.readdir(dirPath);
        for (const file of files) {
            const filePath = path.resolve(dirPath, file);
            const stats = await fs.stat(filePath);
            if (stats.isDirectory()) {
                await clearDirectory(filePath, whenDeleted);
                await fs.rmdir(filePath);
            } else {
                await fs.unlink(filePath);
            }
            whenDeleted(filePath);
        }
    }
}

export async function randomUserAgent(app) {
    if (UAs.length === 0) {
        UAs = (await loadFile(app.App.getFilePath("./dat/user-agents.txt")))
            .split("\n")
            .map((ua) => ua.trim())
            .filter((ua) => ua.length > 0);
    }
    return UAs[randomInt(0, UAs.length - 1)];
}

/**
 * @param {string} url 
 * @param {RequestInit} options 
 * @returns {Promise<Response>}
 */
export async function loadWeb(url, options = {}) {
    return await fetch(url, options);
}



