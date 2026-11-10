import { getDatabase, sendError } from "../lib/server.js";

export default async function handler(request, response) {
  try {
    const database = await getDatabase();
    const result = await database.collection("organizations").deleteOne({ _id: "gdj-platinum" });
    response.setHeader("Cache-Control", "no-store");
    return response.status(200).json({
      success: true,
      deletedCount: result.deletedCount,
      message: result.deletedCount > 0 ? "gdj-platinum removed successfully." : "gdj-platinum not found."
    });
  } catch (error) {
    return sendError(response, error);
  }
}
