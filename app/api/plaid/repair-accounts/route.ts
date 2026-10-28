import { plaidDisabledResponse } from "../disabled";

export async function GET(request: Request) {
  return plaidDisabledResponse(request);
}
