const express = require('express')
const cors = require('cors')
require('dotenv').config()
const jwt = require('jsonwebtoken')
const { v4: uuidv4 } = require("uuid");
const { MongoClient, ServerApiVersion,ObjectId } = require('mongodb');
const app = express()
const port = process.env.PORT || 5000;

const corsOptions = {
  origin: ['http://localhost:5173',],
  credentials: true,
}

app.use(cors(corsOptions));
app.use(express.json())


// const uri = "mongodb+srv://<db_username>:<db_password>@cluster0.9jgyd7l.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.9jgyd7l.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
console.log(uri);


// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();

    const userCollection = client.db('ECashDB').collection('users')
    const transactionCollection = client.db('ECashDB').collection('transaction')

    app.get("/current-user", async (req, res) => {
      try {
          const token = req.headers.authorization?.split(" ")[1];
          if (!token) return res.status(401).json({ message: "Unauthorized" });
  
          const decoded = jwt.verify(token, process.env.JWT_SECRET);
          const user = await userCollection.findOne(
              { _id: new ObjectId (decoded.id) }, // ✅ Convert to ObjectId
              { projection: { pin: 0 } }
          );
  
          if (!user) return res.status(404).json({ message: "User not found" });
  
          res.json({ user });
      } catch (error) {
          console.error("Server error:", error);
          res.status(500).json({ message: "Server error" });
      }
  });

      // Get the total balance of all users
    app.get('/total-balance', async (req, res) => {
      try {
        const users = await userCollection.find().toArray();
        const systemData = await userCollection.findOne(
          { accountType: "admin" }, // Assuming only the admin user has this field
          { projection: { totalSystemBalance: 1 } }
        );
        
        console.log(systemData ? systemData.totalSystemBalance : "Not found");

        console.log(users)
        const totalUserBalance = users.reduce((sum, user) => sum + user.balance, 0);
        const totalBalance = systemData.totalSystemBalance + totalUserBalance


        res.status(200).json({ totalBalance });
      } catch (error) {
        console.error("Error fetching total balance:", error);
        res.status(500).json({ message: "Server error" });
      }
    });



    // get all user from user collection
    app.get('/user', async(req, res)=>{
      const result = await userCollection.find().toArray()
      res.send(result)
      
    })

    // update user data
    app.get("/users/:mobile", async (req, res) => {
      try {
          const { mobile } = req.params;
          const user = await userCollection.findOne({ mobile: mobile });
  
          if (!user) {
              return res.status(404).json({ success: false, message: "User not found" });
          }
  
          res.json(user); // ✅ Send updated user data
      } catch (error) {
          res.status(500).json({ success: false, message: "Server error" });
      }
  });

    // for regsiter post data
    app.post('/user', async(req, res)=>{
      const { name, mobile, email, pin, accountType, nid, image } = req.body;

      try {
        const mobileExist = await userCollection.findOne({mobile : mobile});
        const nidExist = await userCollection.findOne({nid : nid});
        const emailExist = await userCollection.findOne({email : email});
        if (mobileExist) return res.status(201).json({ message: `Mobile number already exists` });
        if (nidExist) return res.status(201).json({ message: `NID already exists` });
        if (emailExist) return res.status(201).json({ message: `Email already exists` });
    
        // const hashedPin = await bcrypt.hash(pin, 10);
        const newUser = { name, mobile, email, image, pin, accountType, nid, balance: 40 };
        
        const result = await userCollection.insertOne(newUser)
        res.send(result)
    
      } catch (error) {
        res.status(500).json({ message: 'Server error' });
      }
    })

    // login
    app.post('/login', async (req, res) => {
      const { mobile, pin } = req.body;
      console.log("Login request received:", mobile, pin); // Debugging
      try {
          // Find user by mobile OR email
          const user = await userCollection.findOne({
              $or: [{ mobile: mobile }]
          });
  
          if (!user) {
            console.log("User not found for mobile:", mobile);
              return res.status(201).json({ success: false, message: "User not found" });
          }
  
          // Check if PIN matches
          if (user.pin !== pin) {
            console.log("Incorrect PIN for mobile:", mobile);
              return res.status(201).json({ success: false, message: "Incorrect PIN" });
          }

            // ✅ Generate JWT Token
            const token = jwt.sign({ id: user._id }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: "7d" });

  
          // Send success response with user details (excluding PIN for security)
          res.status(200).json({
              success: true,
              message: "Login successful",
              user: {
                  _id: user._id,
                  name: user.name,
                  image: user.image,
                  mobile: user.mobile,
                  email: user.email,
                  accountType: user.accountType,
                  balance: user.balance
              }
          });
  
      } catch (error) {
        console.error("Login error:", error); // Show the real error
          res.status(500).json({ success: false, message: "Server error", error: error.message });
      }
  });

// send money operation and transaction store
  app.post('/send-money', async (req, res) => {
    try {
        const { senderMobile, receiverMobile, amount } = req.body;
        console.log(req.body);

        const sendAmount = parseFloat(amount);
        if (sendAmount < 50) {
            return res.status(400).json({ message: "Minimum transfer amount is 50 Taka." });
        }

        const sender = await userCollection.findOne({ mobile: senderMobile });
        const receiver = await userCollection.findOne({ mobile: receiverMobile });

        if (!sender) return res.status(404).json({ message: "Sender not found!" });
        if (!receiver) return res.status(404).json({ message: "Receiver not found!" });

        let transactionFee = sendAmount > 100 ? 5 : 0;
        let totalDeduct = sendAmount + transactionFee;

        if (sender.balance < totalDeduct) {
            return res.status(400).json({ message: "Insufficient balance." });
        }

        const admin = await userCollection.findOne({ accountType: "admin" });
        if (!admin) {
            return res.status(500).json({ message: "Admin account missing!" });
        }

        // Start a transaction session
        const session = client.startSession();
        session.startTransaction();

        try {
            // Update Balances
            await userCollection.updateOne({ mobile: senderMobile }, { $inc: { balance: -totalDeduct } }, { session });
            await userCollection.updateOne({ mobile: receiverMobile }, { $inc: { balance: sendAmount } }, { session });
            await userCollection.updateOne({ accountType: "admin" }, { $inc: { balance: transactionFee, totalSystemBalance: transactionFee } }, { session });

            // Create Transaction Record
            const transaction = {
                transactionId: uuidv4(),
                from: senderMobile,
                to: receiverMobile,
                amount: sendAmount,
                transactionType: "send",
                status: "success",
                charge: transactionFee,
                timestamp: new Date(),
            };

            await transactionCollection.insertOne(transaction, { session });

            // Commit transaction
            await session.commitTransaction();
            session.endSession();

            res.json({ message: `Transaction successful! Sent: ${sendAmount} Taka, Fee: ${transactionFee} Taka`, transaction });

        } catch (err) {
            await session.abortTransaction();
            session.endSession();
            console.error("Transaction failed:", err);
            res.status(500).json({ message: "Transaction failed, please try again." });
        }

    } catch (error) {
        console.error("Transaction error:", error);
        res.status(500).json({ message: "Internal server error." });
    }
});

// cashout operation and transaction store
app.post('/cash-out', async (req, res) => {
  try {
      const { userMobile, agentMobile, amount, pin } = req.body;
      console.log(req.body);

      const cashOutAmount = parseFloat(amount);
      if (cashOutAmount < 50) {
          return res.status(400).json({ message: "Minimum cash-out amount is 50 Taka." });
      }

      const user = await userCollection.findOne({ mobile: userMobile });
      const agent = await userCollection.findOne({ mobile: agentMobile, accountType: "agent" });
      console.log(user);
      console.log(agent);
      

      if (!user) return res.status(404).json({ message: "User not found!" });
      if (!agent) return res.status(404).json({ message: "Agent not found / unauthorized!" });
      if (user.pin !== pin) return res.status(403).json({ message: "Invalid PIN!" });

      let cashOutFee = (cashOutAmount * 1.5) / 100;
      let agentIncome = (cashOutAmount * 1) / 100;
      let adminIncome = (cashOutAmount * 0.5) / 100;
      let totalDeduct = cashOutAmount + cashOutFee;

      if (user.balance < totalDeduct) {
          return res.status(400).json({ message: "Insufficient balance." });
      }

      const admin = await userCollection.findOne({ accountType: "admin" });
      if (!admin) {
          return res.status(500).json({ message: "Admin account missing!" });
      }

      // Start a transaction session
      const session = client.startSession();
      session.startTransaction();

      try {
          // Update balances
          await userCollection.updateOne({ mobile: userMobile }, { $inc: { balance: -totalDeduct } }, { session });
          await userCollection.updateOne({ mobile: agentMobile }, { $inc: { balance : +agentIncome } }, { session });
          await userCollection.updateOne({ accountType: "admin" }, { $inc: { balance: adminIncome, totalSystemBalance: adminIncome } }, { session });

          // Create Transaction Record
          const transaction = {
              transactionId: uuidv4(),
              from: userMobile,
              to: agentMobile,
              amount: cashOutAmount,
              transactionType: "cash-out",
              status: "success",
              charge: cashOutFee,
              agentIncome,
              adminIncome,
              timestamp: new Date(),
          };

          await transactionCollection.insertOne(transaction, { session });

          // Commit transaction
          await session.commitTransaction();
          session.endSession();

          res.json({ message: `Cash-out successful! Withdrawn: ${cashOutAmount} Taka, Fee: ${cashOutFee} Taka`, transaction });

      } catch (err) {
          await session.abortTransaction();
          session.endSession();
          console.error("Cash-out failed:", err);
          res.status(500).json({ message: "Cash-out failed, please try again." });
      }

  } catch (error) {
      console.error("Cash-out error:", error);
      res.status(500).json({ message: "Internal server error." });
  }
});


// cashIn operation and transaction store
app.post('/cash-in', async (req, res) => {
  try {
      const { userMobile, agentMobile, amount, pin } = req.body;
      console.log(req.body);

      const cashInAmount = parseFloat(amount);
      if (cashInAmount < 50) {
          return res.status(400).json({ message: "Minimum cash-in amount is 50 Taka." });
      }

      const user = await userCollection.findOne({ mobile: userMobile });
      const agent = await userCollection.findOne({ mobile: agentMobile, accountType: "agent" });

      if (!user) return res.status(404).json({ message: "User not found!" });
      if (!agent) return res.status(404).json({ message: "Agent not found or unauthorized!" });
      if (agent.pin !== pin) return res.status(403).json({ message: "Invalid PIN!" });

      if (agent.balance < cashInAmount) {
          return res.status(400).json({ message: "Agent has insufficient balance." });
      }

      const admin = await userCollection.findOne({ accountType: "admin" });
      if (!admin) {
          return res.status(500).json({ message: "Admin account missing!" });
      }

      // Start a transaction session
      const session = client.startSession();
      session.startTransaction();

      try {
          // Update balances
          await userCollection.updateOne({ mobile: userMobile }, { $inc: { balance: cashInAmount } }, { session });
          await userCollection.updateOne({ mobile: agentMobile }, { $inc: { balance: -cashInAmount } }, { session });
          await userCollection.updateOne({ accountType: "admin" }, { $inc: { totalSystemBalance: cashInAmount } }, { session });

          // Create Transaction Record
          const transaction = {
              transactionId: uuidv4(),
              from: agentMobile,
              to: userMobile,
              amount: cashInAmount,
              transactionType: "cash-in",
              status: "success",
              timestamp: new Date(),
          };

          await transactionCollection.insertOne(transaction, { session });

          // Commit transaction
          await session.commitTransaction();
          session.endSession();

          res.json({ message: `Cash-in successful! ${cashInAmount} Taka added to user account.`, transaction });

      } catch (err) {
          await session.abortTransaction();
          session.endSession();
          console.error("Cash-in failed:", err);
          res.status(500).json({ message: "Cash-in failed, please try again." });
      }

  } catch (error) {
      console.error("Cash-in error:", error);
      res.status(500).json({ message: "Internal server error." });
  }
});

  // get transaction based on user
  app.get('/my-transaction/:mobile', async (req, res) => {
    try {
        const mobile = req.params.mobile;

        // Find transactions where the user is either sender or receiver
        // const transactions = await transactionCollection.find({ from: mobile }).toArray();
        const transactions = await transactionCollection.find({
          $or: [{ from: mobile }, { to: mobile }]
      }).toArray();

        if (!transactions.length) {
            return res.status(404).json({ message: "No transactions found!" });
        }

        res.json(transactions);
    } catch (error) {
        console.error("Error fetching transactions:", error);
        res.status(500).json({ message: "Internal server error" });
    }
});







    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);


app.get('/', (req, res) => {
  res.send('Hello World! Arafat hosen')
})


app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})