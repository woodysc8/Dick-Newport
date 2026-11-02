import { plaidDisabledResponse } from "../disabled";

export async function POST(request: Request) {
  return plaidDisabledResponse(request);
}
