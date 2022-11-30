import path from "path";
import stream from "stream";
import { promisify } from "util";
import gunzip from "gunzip-maybe";
import tar from "tar-fs";
import fetch from "node-fetch";

const pipeline = promisify(stream.pipeline);

export async function download() {}
