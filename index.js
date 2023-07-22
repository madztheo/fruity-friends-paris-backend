const express = require("express");
const { auth, resolver, loaders } = require("@iden3/js-iden3-auth");
const getRawBody = require("raw-body");
const { Base64 } = require("js-base64");

const app = express();
const port = process.env.PORT || 8080;

app.use(express.static("static"));

app.get("/api/polygon-id/sign-in", async (req, res) => {
  console.log("get Auth Request");
  console.log(loaders);
  const request = await GetAuthRequest(req, res);
  return res.status(200).set("Content-Type", "application/json").send(request);
});

app.get("/api/polygon-id/sign-in/deeplink", async (req, res) => {
  console.log("get Auth Request");
  const request = await GetAuthRequest(req, res);
  const encoded = Base64.encode(JSON.stringify(request));
  return res
    .status(200)
    .set("Content-Type", "application/json")
    .send({ url: `iden3comm://?i_m=${encoded}` });
});

app.post("/api/polygon-id/callback", (req, res) => {
  console.log("callback");
  Callback(req, res);
});

app.listen(port, () => {
  console.log(`server running on port ${port}`);
});

// Create a map to store the auth requests and their session IDs
const requestMap = {};

// GetQR returns auth request
async function GetAuthRequest(req, res) {
  // Audience is verifier id
  const hostUrl = `${req.protocol}://${req.hostname}`;
  const sessionId = 1;
  const callbackURL = "/api/polygon-id/callback";
  const audience =
    "did:polygonid:polygon:mumbai:2qDyy1kEo2AYcP3RT4XGea7BtxsY285szg6yP9SPrs";

  const uri = `${hostUrl}${callbackURL}?sessionId=${sessionId}`;

  // Generate request for basic authentication
  const request = auth.createAuthorizationRequest("test flow", audience, uri);

  // Add request for a specific proof
  const proofRequest = {
    id: 1,
    circuitId: "credentialAtomicQuerySigV2",
    query: {
      allowedIssuers: ["*"],
      type: "ageCheck",
      context: "ipfs://QmbqiY8E1Lq6mneASQTsJSfF57TDRLcKQSi7RUomXS4HFF",
      credentialSubject: {
        birthdate: {
          $lt: 20000101,
        },
      },
    },
  };
  const scope = request.body.scope ?? [];
  request.body.scope = [...scope, proofRequest];

  // Store auth request in map associated with session ID
  requestMap[`${sessionId}`] = request;
  console.log("requestMap");
  console.log(requestMap);
  return request;
}

// Callback verifies the proof after sign-in callbacks
async function Callback(req, res) {
  // Get session ID from request
  const sessionId = req.query.sessionId;

  // get JWZ token params from the post request
  const raw = await getRawBody(req);
  const tokenStr = raw.toString().trim();

  const ethURL = "https://rpc.ankr.com/polygon_mumbai";
  const contractAddress = "0x134B1BE34911E39A8397ec6289782989729807a4";
  const keyDIR = "./keys";

  const ethStateResolver = new resolver.EthStateResolver(
    ethURL,
    contractAddress
  );

  const resolvers = {
    ["polygon:mumbai"]: ethStateResolver,
  };

  // fetch authRequest from sessionID
  console.log("requestMap");
  console.log(requestMap);
  const authRequest = requestMap[`${sessionId}`];

  // Locate the directory that contains circuit's verification keys
  const verificationKeyloader = new loaders.FSKeyLoader(keyDIR);
  //const sLoader = loaders.getDocumentLoader("ipfs.io");
  const schemaLoader = loaders.getDocumentLoader({
    ipfsNodeURL: "ipfs.io",
  });

  // EXECUTE VERIFICATION
  const verifier = await auth.Verifier.newVerifier(
    verificationKeyloader,
    resolvers,
    {
      documentLoader: schemaLoader,
    }
  );
  console.log("verifier");
  console.log(verifier);

  try {
    const opts = {
      AcceptedStateTransitionDelay: 5 * 60 * 1000, // 5 minute
    };
    console.log("About to verify");
    console.log(tokenStr);
    console.log(authRequest);
    console.log(opts);
    authResponse = await verifier.fullVerify(tokenStr, authRequest, opts);
    console.log("authResponse");
    console.log(authResponse);
  } catch (error) {
    console.log(error);
    return res.status(500).send(error);
  }
  return res
    .status(200)
    .set("Content-Type", "application/json")
    .send("user with ID: " + authResponse.from + " Succesfully authenticated");
}
