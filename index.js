const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config()
const stripe = require('stripe')(process.env.PAYMENT_SECRET_KEY)
const app = express()
const port = process.env.PORT || 5000;

// middleware
app.use(cors())
app.use(express.json())

const verifyJWT = (req, res, next) => {
    const authorization = req.headers.authorization;
    if (!authorization) {
        res.status(401).send({ error: true, message: "unauthorized access" })
    }
    // bearer token
    const token = authorization.split(' ')[1];
    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
            res.status(401).send({ error: true, message: "unauthorized access" })
        }
        req.decoded = decoded;
        next();
    })
}

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.pmjxifl.mongodb.net/?retryWrites=true&w=majority`;

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
        await client.connect();

        const usersCollection = client.db("bistroDB").collection('users')
        const menuCollection = client.db("bistroDB").collection('menu')
        const reviewCollection = client.db("bistroDB").collection('reviews')
        const cartCollection = client.db("bistroDB").collection('carts')
        const paymentCollection = client.db("bistroDB").collection('payments')

        app.post('/jwt', (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
                expiresIn: '1h'
            })
            res.send(token)
        })
        // user verifyJWT before using verifyAdmin
        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email: email }
            const user = await usersCollection.findOne(query)
            if (user?.role !== 'admin') {
                return res.status(403).send({ error: true, message: "forbidden authorized" })
            }
            next();
        }

        // users api
        /*
        0.do not show secure links those who should not see the links
        1.use jwt token :verifyJWT
        2.use verifyAdmin middleware
        3.
        **/
        app.get('/users', verifyJWT, verifyAdmin, async (req, res) => {
            const result = await usersCollection.find().toArray();
            res.send(result)
        })

        app.post('/users', async (req, res) => {
            const user = req.body;
            console.log(user)
            const qurey = { email: user.email }
            const existingUser = await usersCollection.findOne(qurey)
            console.log('existing user', existingUser)
            if (existingUser) {
                return res.send({ message: "user already has a account" })
            }
            const result = await usersCollection.insertOne(user)
            res.send(result)
        })

        // security layer :verifyJWT
        // check email same
        // check admin

        app.get('/users/admin/:email', verifyJWT, async (req, res) => {
            const email = req.params.email;

            if (req.decoded.email !== email) {
                res.send({ admin: false })
            }
            const query = { email: email }
            const user = await usersCollection.findOne(query)
            const result = { admin: user?.role === 'admin' }
            res.send(result)
        })
        app.patch('/users/admin/:id', async (req, res) => {
            const id = req.params.id;
            console.log(id)
            const filter = { _id: new ObjectId(id) }
            const updateDoc = {
                $set: {
                    role: "admin"
                }
            }
            const result = await usersCollection.updateOne(filter, updateDoc);
            res.send(result)
        });


        // menu collection
        app.get('/menu', async (req, res) => {
            const result = await menuCollection.find().toArray()
            res.send(result)
        })
        app.post('/menu', verifyJWT, verifyAdmin, async (req, res) => {
            const newItem = req.body;
            const result = await menuCollection.insertOne(newItem);
            res.send(result);
        })
        app.delete('/menu/:id', verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await menuCollection.deleteOne(query);
            res.send(result)
        })

        // reviews collection
        app.get('/reviews', async (req, res) => {
            const result = await reviewCollection.find().toArray()
            res.send(result)
        })
        // cart collection
        app.get('/carts', verifyJWT, async (req, res) => {
            const email = req.query.email;
            if (!email) {
                res.send([])
            }

            const decodedEmail = req.decoded.email
            if (email !== decodedEmail) {
                return res.status(403).send({ error: true, message: 'Forbidden access' })
            }

            else {
                const query = { email: email }
                const result = await cartCollection.find(query).toArray()
                res.send(result)
            }
        })

        app.post('/carts', async (req, res) => {
            const item = req.body;
            console.log(item)
            const result = await cartCollection.insertOne(item)
            res.send(result)
        })
        app.delete('/carts/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await cartCollection.deleteOne(query)
            res.send(result)
        })
        // payment intent
        app.post('/create-payment-intent', verifyJWT, async (req, res) => {
            const { price } = req.body;
            const amount = price * 100;
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: 'usd',
                payment_method_types: ['card']
            });
            res.send({
                clientSecret: paymentIntent.client_secret
            })
        })
        // payment related information
        app.post('/payments', verifyJWT, async (req, res) => {
            const payment = req.body;
            const insertedResult = await paymentCollection.insertOne(payment)

            const query = { _id: { $in: payment.cartItems.map(id => new ObjectId(id)) } }

            const deleteResult = await cartCollection.deleteMany(query)
            res.send({ insertedResult, deleteResult })
        })
        // admin home section
        app.get('/admin-status', verifyJWT, verifyAdmin, async (req, res) => {
            const users = await usersCollection.estimatedDocumentCount();
            const products = await menuCollection.estimatedDocumentCount();
            const orders = await paymentCollection.estimatedDocumentCount();

            // best way to get sum of the price field is to use is group and sum operator
            /*
            await paymentCollection.aggregate([
            { $group:{
                    _id: null,
                    total: {sum: '$price'}
                }
            }
            ]).toArray();
            
            */
            const payments = await paymentCollection.find().toArray();
            const revenue = payments.reduce((sum, payment) => sum + payment.price, 0)

            res.send({
                users,
                revenue,
                products,
                orders,
            })
        })
        // Bangla system/second best option
        /**
         * 1.load all payments
         * 2.for each payments get menuItems array
         * 3.for each items in the menuItems array get the menuItems from the menuCollection
         * 4.put them in array: allOrderedItems
         * 5.separate allOrderItems  by category using filters
         * 6.now get the quantity by using length: pizzas.length
         * 7.for each category use reduce to get the total amount spent on this category
         * 8.
         * */
        app.get('/order-status', verifyJWT, verifyAdmin, async (req, res) => {
            const pipeLine = [
                {
                    $lookup: {
                        from: 'menu',
                        localField: 'menuItems',
                        foreignField: '_id',
                        as: 'menuItemDetails',
                    },
                },
                { $unwind: '$menuItemDetails' },
                {
                    $group: {
                        _id: "$menuItemDetails.category",
                        count: { $sum: 1 },
                        totalPrice: { $sum: '$menuItemDetails.price' },
                    },
                },
                {
                    $project: {
                        category: "$_id",
                        count: 1,
                        totalPrice: { $round: ["$totalPrice", 2] },
                        _id: 0
                    }
                }
            ]
            const result = await paymentCollection.aggregate(pipeLine).toArray();
            res.send(result)
        })
        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);


app.get('/', (req, res) => {
    res.send('boss is sitting')
})
app.listen(port, () => {
    console.log(`boss is sitting at ${port}`)
})