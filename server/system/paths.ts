// 两个根,分开说:
//   REPO_ROOT —— 代码在哪(仓库根;打包后是 core/,但打包态的代码位置都由壳显式传入,这里只服务开发态)
//   DATA_HOME —— 数据在哪(database/ favicons/ logs/ files/)。开发态也不落进仓库,
//                和打包态一样进 Application Support,只是目录名带 Dev,两边互不干扰。
import fs from "node:fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.join(__dirname, "../..");
export const DATA_HOME = process.env.WORKTOP_HOME || path.join(os.homedir(), "Library/Application Support/Worktop Dev");

const PRODUCT_HOME = path.resolve(process.env.WORKTOP_PRODUCT_HOME || path.join(os.homedir(), ".worktop"));
export const productHome = () => { fs.mkdirSync(PRODUCT_HOME, { recursive: true }); return PRODUCT_HOME; };
