import apiHandler from "../../api/organizations/mine.js";
import { runApi } from "./_adapter.js";

export const handler = (event) => runApi(apiHandler, event);
