import express from "express"
import cors from "cors"
import "dotenv/config"
import { MongoClient } from "mongodb"

const app = express()
const port = process.env.PORT || 5000

app.use(express.json())
app.use(cors({ origin: process.env.CLIENT_URL, credentials: true }))

const client = new MongoClient(process.env.MONGODB_URI)

async function connectToMongoDB() {
  try {
    await client.connect()
    console.log("Connected to MongoDB")
    return client
  } catch (err) {
    console.dir(err)
  }
}

const connectedClient = await connectToMongoDB()
const database = connectedClient.db("wedplandb")

app.get("/", (req, res) => {
  res.send("WedPlan server is running")
})

app.listen(port, () => {
  console.log(`WedPlan server is running on port ${port}`)
})

export default app
