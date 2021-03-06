if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config()
}

const express = require('express');
const path = require('path')
const app = express();
const bcrypt = require('bcrypt')
const passport = require('passport')
const flash = require('express-flash')
const session = require('express-session')
const methodOverride = require('method-override')
const bodyParser = require('body-parser')
const knex = require('./db/knex')

const initializePassport = require('./passport-config')
initializePassport(
    passport,
    email => users.find(user => user.email === email),
    id => users.find(user => user.id === id)
)

//this will hold stuff pulled from the db
let users = []

//let stat = []

let devID;
let hum;
let temp;

//this will hold current user id
//let userid

app.use("/public", express.static(path.join(__dirname,'public')))
app.use(bodyParser.urlencoded({extended: false}))
app.use(bodyParser.json())
app.use(express.urlencoded({extended:false}))
app.use(flash())
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false
}))
app.use(passport.initialize())
app.use(passport.session())
app.use(methodOverride('_method'))

app.set('view engine', 'ejs');

app.get("/", checkNotAuthenticated , async (req,res) => {
    users = await getAllUsers()
    res.sendFile(path.join(__dirname,'public/auth.html'))
})

app.post("/", checkNotAuthenticated, passport.authenticate('local', {
    successRedirect: '/home',
    failureRedirect: '/',
    failureFlash: true
}))


app.get("/home", checkAuthenticated, (req, res) => {
    //console.log(req.user.id) //current signed in user ID
    res.render("index", {temperature: temp, humidity: hum, loc: req.user.location})
})


app.patch('/home', async (req, res) => {
    try {
        console.log(req.user.id)
        await updateUser(req.user.id, req.body)
        console.log('user info updated')
    } catch {
        console.log('user info not updated')
        res.redirect('back')
    }
    //if u want to display the same user picks every time a user logs in then
    //gonna have to use jquery ajax again
    //rough but doable. do we need it tho? :\
})

app.get("/create", (req, res) => {
    res.sendFile(path.join(__dirname, 'public/user.html'))
})

app.post("/create", checkNotAuthenticated, async (req,res) => {
    try {
        const hashedPassword = await bcrypt.hash(req.body.password, 10)
        await createUser({
            id: Date.now().toString(),
            name: req.body.name,
            email: req.body.email,
            location: req.body.location,
            password: hashedPassword
        })
        console.log("Added to DB")
        res.redirect("/")
    } catch {
        console.log("Not Added to DB")
        res.redirect("/create")
    }
})

app.get('/settings', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/settings.html'))
})

app.patch('/settings', async (req, res) => {
    try {
        console.log(req.user.id)
        if (req.body.password){
            await updateUser(req.user.id, req.body) //if password is blank it is not sent
            await updateUser(req.user.id, {
                password: await bcrypt.hash(req.body.password, 10),
            })
        } else {
            await updateUser(req.user.id, req.body)
        }
        console.log('user info updated')
    } catch {
        console.log('user info not updated')
        res.redirect('back')
    }
    //if u want to display the same user picks every time a user logs in then
    //gonna have to use jquery ajax again
    //rough but doable. do we need it tho? :\
})

app.delete('/logout', (req, res) => {
    req.logOut()
    res.redirect('/')//SAVETHIS
})

//this is where the mcu should hit, YES IT WORKS IN MY BROWSER
//ADD SQL SCRIPT TO THE JS FILE
app.get('/api', async (req, res) => {
    devID = req.query.dev_id
    temp = req.query.inside_temp
    hum = req.query.hum


    const userr = await getMCU(devID) //get mcu id

    const dbTempOBJ = await knex.raw("SELECT inside_temp from Temps where dev_id = " + req.query.dev_id + " ORDER BY end_time DESC LIMIT 1")
    const dbTemp = dbTempOBJ[0].inside_temp

    if(temp >= dbTemp - 1 && temp <= dbTemp + 1){
        await knex.raw("UPDATE Temps set end_time = DATETIME('NOW') where end_time = " +
            "(SELECT end_time from Temps ORDER BY end_time DESC LIMIT 1)"
            + "" +
            ";")
    } else {
        await knex.raw("INSERT INTO Temps values (" + devID + ", " + temp + ", " + hum + ", DATETIME('NOW'), DATETIME('NOW'));")
    }

    let goingHomeObj = await knex.raw("SELECT goingHome, arrivalTime, reqTemp from userCredentials where id = (SELECT user_id from Devs where id = " + req.query.dev_id + ");")
    let going_home = goingHomeObj[0].goingHome
    const arrivalTime = goingHomeObj[0].arrivalTime
    const reqTemp = goingHomeObj[0].reqTemp

    console.log("here")
    console.log(going_home)
    console.log(arrivalTime)
    if(going_home){
        console.log("UPDATE")
        //await knex.raw("UPDATE Devs set heat_time = DATETIME('NOW') where id = " + req.query.dev_id + ";")
    }else if (arrivalTime){
        console.log("update 2")
        await knex.raw("UPDATE Devs set heat_time = datetime(\n" +
            "            julianday(\"" + arrivalTime + "\")\n" +
            "            -\n" +
            "            (\n" +
            "                    julianday((SELECT start_time FROM Temps where dev_id = " + devID + " AND inside_temp = " + reqTemp + " limit 1))\n" +
            "                    -\n" +
            "                    julianday((SELECT end_time FROM Temps where dev_id = " + devID + " AND inside_temp = " + temp + " AND end_time < (\n" +
            "                        SELECT start_time FROM Temps where dev_id = " + devID + " AND inside_temp = " + reqTemp + " limit 1\n" +
            "                        ) limit 1))\n" +
            "                )\n" +
            "    ) where id = " + devID + ";")
        await knex.raw("UPDATE userCredentials set arrivalTime = \"\" where id = (SELECT user_id from Devs where id = " + req.query.dev_id + ");")
    }

    const heatTimeObj = await knex.raw("SELECT heat_time from Devs where id = " + req.query.dev_id + ";")
    const heatTime = heatTimeObj[0].goingHome
    if(heatTime)
        await knex.raw("UPDATE userCredentials set goingHome = (case when (select heat_time from Devs where id = 1) < DATETIME(\"now\") then 1 else 0 end) where id = (SELECT user_id from Devs where id = " + req.query.dev_id + ");")

    goingHomeObj = await knex.raw("SELECT goingHome from userCredentials where id = (SELECT user_id from Devs where id = " + req.query.dev_id + ");")
    going_home = goingHomeObj[0].goingHome
    if(going_home){
        await knex.raw("UPDATE Devs set heat_time = \"\" where id =  " + req.query.dev_id + ";")
    }


    const id = await getUser(userr[0].user_id) //get user id

    const minTemp = id[0].minTemp
    const goingHome = id[0].goingHome
    const dataString = minTemp + '/' + reqTemp + '/' + goingHome + '/'
    res.send(dataString)
})

function sendInsideStat(temp, hum)
{
    stat = {
        "temperature": temp,
        "humidity": hum
    }

}

function checkAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
        return next()
    }

    res.redirect('/login')
}

function checkNotAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
        return res.redirect('/')
    }
    next()
}

function tempGetter (string){
// call the data from the Database
    let cityName = string; // need the call here
    const api="https://api.openweathermap.org/data/2.5/weather?q="+cityName+"&appid=ecd9898e21ff116af537053f34e4b6b7&units=metric";
    fetch(api)
        .then(response => {return response.json();
        })
        .then(data => {console.log(data);
            //to call weather go data(where the api link is stored) main(where the temp is saved into(submenu)) and temp for temp.
            // look at console.log(data) to see where to find the info you need from.
            return data.main.temp});
    //this returns only temp.

}

function createUser(user){
    return knex('userCredentials').insert(user)
}

function getUser(id){
    return knex('userCredentials').where('id', id).select()
}

function getMCU(id){
    return knex('Devs').where('id', id).select()
}

function getAllUsers(){
    return knex('userCredentials').select('*')
}

function deleteUser(id){
    return knex('userCredentials').where('id', id).del()
}

function updateUser(id, userData){
    return knex('userCredentials').where('id', id).update(userData)
}

function addData(data){
    return knex('Devs').insert(data)
}

function addDataTemps(data){
    return knex('Temps').insert(data)
}

function getTemp(id) {
    return knex('Temps').where('id', id).select()
}


app.listen(3000);
