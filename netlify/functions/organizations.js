import apiHandler from "../../api/organizations/index.js";
import { runApi } from "./_adapter.js";

export const handler = (event) => runApi(apiHandler, event);
