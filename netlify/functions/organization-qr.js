import apiHandler from "../../api/organization-qr/[slug].js";
import { runApi } from "./_adapter.js";

export const handler = (event) => runApi(apiHandler, event);
