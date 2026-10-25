import apiHandler from "../../api/organizations/[slug].js";
import { runApi } from "./_adapter.js";

export const handler = (event) => runApi(apiHandler, event);
