import apiHandler from "../../api/auth/workspace.js";
import { runApi } from "./_adapter.js";

export const handler = (event) => runApi(apiHandler, event);
