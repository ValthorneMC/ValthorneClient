import assert from "node:assert/strict";
import { test } from "node:test";
import { amzNow, makePresigner } from "../src/index.ts";

// Example from the AWS SigV4 documentation ("Authenticating Requests: Using Query Parameters").
test("presigned GET matches the AWS reference signature", async () => {
  const presign = await makePresigner({
    host: "examplebucket.s3.amazonaws.com",
    bucket: "",
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    region: "us-east-1",
    amzDate: "20130524T000000Z",
    expires: 86400,
  });

  assert.equal(
    await presign("test.txt"),
    "https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256" +
      "&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request" +
      "&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host" +
      "&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404",
  );
});

test("amzNow uses the compact SigV4 timestamp format", () => {
  assert.equal(amzNow(new Date("2013-05-24T00:00:00.123Z")), "20130524T000000Z");
});
