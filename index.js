const express = require("express");
const { auth, resolver, loaders } = require("@iden3/js-iden3-auth");
const getRawBody = require("raw-body");
const { Base64 } = require("js-base64");

const app = express();
const port = process.env.PORT || 8080;
const multer = require("multer");
const upload = multer(); // Initialize multer instance
const cors = require("cors")

const mongoose = require('mongoose');
mongoose.connect('mongodb://127.0.0.1:27017');

mongoose.connection.on('error', function() {
  console.log("mongoose error")
})

mongoose.connection.on('connected', function() {
  console.log("mongoose connected")
})

const Person = mongoose.model('Person', { 
  name: String,
  description: String,
  picture: String,
  age: Number,
  isVerified: Boolean,
  address: String
});

const Like = mongoose.model("Like", {
  from: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  to: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  match: Boolean,
})

app.use(express.static("public"));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(upload.none()); // Set upload.none() as the default middleware for all routes
app.use(cors());

app.post("/api/person", async (req, res) => {
  try {
    console.log("post person");

    const foundPerson = await Person.findOne({ address: req.body.address });
    console.log(foundPerson)
    if (foundPerson) return res.status(400).json({ error: "Person already exists" });

    const person = new Person(req.body);
    await person.save();
    return res.status(200).json(person);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

app.put("/api/person/:id", async (req, res) => {
  try {
    const updatedPerson = await Person.findOneAndUpdate(
      { _id: req.params.id },
      { $set: req.body },
      { new: true }
    );
    return res.status(200).json(updatedPerson);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/person", async (req, res) => {
  console.log("get persons");
  const person = await Person.find();
  return res.status(200).set("Content-Type", "application/json").send(person);
})

app.get("/api/person/random/:id", async (req, res) => {
  console.log("get random person except id");
  const person = await Person.aggregate([
    { $match: { _id: { $ne: new mongoose.Types.ObjectId(req.params.id) } } },
    { $sample: { size: 1 } }
  ]);
  return res.status(200).set("Content-Type", "application/json").send(person);
})

app.get("/api/person/:id", async (req, res) => {
  console.log("get person");
  const person = await Person.findById(req.params.id);
  console.log(person)
  return res.status(200).set("Content-Type", "application/json").send(person);
})

app.post("/api/like", async (req, res) => {
  console.log("post like");
  const { from, to } = req.body;
  const matches = await Like.find({ from: to, to: from});

  let match = false;
  if (matches.length > 0) {
    match = true;
    console.log("There's a match!")
  }

  const fromDoc = await Person.findById(from);
  const toDoc = await Person.findById(to);

  const like = new Like({ from: fromDoc, to: toDoc, match });
  await like.save();

  return res.status(200).set("Content-Type", "application/json").send(like);
})

app.get("/api/like", async (req, res) => {
  console.log("get likes");
  const like = await Like.find();
  return res.status(200).set("Content-Type", "application/json").send(like);
})


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
  const hostUrl = `https://${req.hostname}`;
  const sessionId = Object.keys(requestMap).length + 1;
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
      //context: `${hostUrl}/schemas/ageCheck.jsonld`,
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
      ipfsGatewayURL: "https://ipfs.io",
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
