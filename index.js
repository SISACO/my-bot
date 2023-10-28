/* eslint-disable max-len */
const fs = require("fs");                              // Importing the 'fs' module for file system operations.
const _ = require("lodash");                         // Importing the 'lodash' module for file system operations.
const wiki = require("wikipedia");                  // Importing the 'wikipedia' module for accessing Wikipedia API.
const convert = require("convert-units");          // Importing the 'convert-units' module for unit conversion functionalities.
const { lowerCase } = require("lower-case");        
const { capitalCase } = require("change-case");
const extractValues = require("extract-values");
const stringSimilarity = require("string-similarity");
const { upperCaseFirst } = require("upper-case-first");

const cors = require("cors");
const path = require("path");
const axios = require("axios");
const morgan = require("morgan");
const dotenv = require("dotenv");
const express = require("express");
const compression = require("compression");
const serveStatic = require("serve-static");

const pkg = require("./package.json");
const mainChat = require("./intents/Main_Chat.json");
const SubstationChat = require("./intents/SubStation.json");
const supportChat = require("./intents/support.json");
const wikipediaChat = require("./intents/wikipedia.json");
const welcomeChat = require("./intents/Default_Welcome.json");
const fallbackChat = require("./intents/Default_Fallback.json");
const unitConverterChat = require("./intents/unit_converter.json");

dotenv.config();  // Load environment variables from .env file into process.env

const standardRating = 0.6;  // Default standard rating for chatbot responses
const botName = process.env.BOT_NAME || pkg.name;  // Retrieve bot name from environment variables or package.json
const developerName = process.env.DEVELOPER_NAME || pkg.author.name;  // Retrieve developer name from environment variables or package.json
const developerEmail = process.env.DEVELOPER_EMAIL || pkg.author.email;  // Retrieve developer email from environment variables or package.json
const bugReportUrl = process.env.DEVELOPER_NAME || pkg.bugs.url;   // Retrieve bug report URL from environment variables or package.json

const app = express();    // Create an Express application
const port = process.env.PORT || 3000;    // Set the port for the server, default to 3000 if not provided in environment variables


/*Combine and deduplicate chat questions from different sources*/
let allQustions = [];

allQustions = _.concat(allQustions, wikipediaChat);
allQustions = _.concat(allQustions, unitConverterChat);
allQustions = _.concat(
  allQustions,
  _.flattenDeep(_.map(supportChat, "questions")),
);
allQustions = _.concat(
  allQustions,
  _.flattenDeep(_.map(mainChat, "questions")),
);
allQustions = _.concat(
  allQustions,
  _.flattenDeep(_.map(SubstationChat, "questions")),
);
allQustions = _.uniq(allQustions);
allQustions = _.compact(allQustions);

const changeUnit = (amount, unitFrom, unitTo) => {  // Function to convert units from one form to another
  try {                                              // Try to perform the unit conversion, handle errors if any
    const convertValue = convert(amount).from(unitFrom).to(unitTo);
    const returnMsg = `${amount} ${convert().describe(unitFrom).plural}(${
      convert().describe(unitFrom).abbr
    }) is equle to ${convertValue} ${convert().describe(unitTo).plural}(${
      convert().describe(unitTo).abbr
    }).`;

    return returnMsg;
  } catch (error) {
    return error.message;    // If there's an error during conversion, return the error message
  }
};

const sendAllQuestions = (req, res) => {    // Function to handle sending all available questions
  const humanQuestions = [];                // Array to store human-readable questions
                                                
  try {                                    
    allQustions.forEach((qus) => {           // Process all questions, format them, and add them to the humanQuestions array
      if (qus.length >= 15) {               // Ensure the question is of sufficient length for processing
        if (
          /^(can|are|may|how|what|when|who|do|where|your|from|is|will|why)/gi.test(
            qus,
          )
        ) {
          humanQuestions.push(`${upperCaseFirst(qus)}?`);
        } else {
          humanQuestions.push(`${upperCaseFirst(qus)}.`);
        }
      }
    });
    res.json(_.shuffle(humanQuestions));      // Shuffle the formatted questions and send as a JSON response
  } catch (error) {
    res.status(500).send({ error: "Internal Server Error!", code: 500 });    // If there's an error, send a 500 Internal Server Error response
    console.log(error);
  }
};

const sendWelcomeMessage = (req, res) => {      // Function to handle sending a welcome message
  res.json({                                    // Send a random welcome message as a JSON response
    responseText: _.sample(welcomeChat),
  });
};

const sendAnswer = async (req, res) => {      // Function to handle sending answers based on user queries
  let isFallback = false;
  let responseText = null;
  let rating = 0;
  let action = null;

  try {
    const query = decodeURIComponent(req.query.q).replace(/\s+/g, " ").trim() || "Hello";    // Retrieve and clean user input from the query parameter
    const humanInput = lowerCase(query.replace(/(\?|\.|!)$/gim, ""));    

    const regExforUnitConverter = /(convert|change|in).{1,2}(\d{1,8})/gim;      // Regular expressions to identify different types of queries
    const regExforWikipedia = /(search for|tell me about|what is|who is)(?!.you) (.{1,30})/gim;
    const regExforSupport = /(invented|programmer|teacher|create|maker|who made|creator|developer|bug|email|report|problems)/gim;
    const regExforSubStation = /(explain)/gim;

    let similarQuestionObj;

    // Determine the type of query using regular expressions and find the best matching question
    if (regExforUnitConverter.test(humanInput)) {    
      action = "unit_converter";
      similarQuestionObj = stringSimilarity.findBestMatch(
        humanInput,
        unitConverterChat,
      ).bestMatch;
    } else if (regExforWikipedia.test(humanInput)) {
      action = "wikipedia";
      similarQuestionObj = stringSimilarity.findBestMatch(
        humanInput,
        wikipediaChat,
      ).bestMatch;
    } else if (regExforSupport.test(humanInput)) {
      action = "support";
      similarQuestionObj = stringSimilarity.findBestMatch(
        humanInput,
        _.flattenDeep(_.map(supportChat, "questions")),
      ).bestMatch;
    } else if (regExforSubStation.test(humanInput)) {
      action = "SubstationChat";
      similarQuestionObj = stringSimilarity.findBestMatch(
        humanInput,
        _.flattenDeep(_.map(SubstationChat, "questions")),
      ).bestMatch;
    }
    else {
      action = "main_chat";
      similarQuestionObj = stringSimilarity.findBestMatch(
        humanInput,
        _.flattenDeep(_.map(mainChat, "questions")),
      ).bestMatch;
    }


    const similarQuestionRating = similarQuestionObj.rating;    // Retrieve the rating and target question from the best matching question
    const similarQuestion = similarQuestionObj.target;

    // Handle different types of queries and generate appropriate responses
    if (action == "unit_converter") {
      const valuesObj = extractValues(humanInput, similarQuestion, {
        delimiters: ["{", "}"],
      });

      rating = 1;
      try {
        const { amount, unitFrom, unitTo } = valuesObj;

        responseText = changeUnit(amount, unitFrom, unitTo);
      } catch (error) {
        responseText = "One or more units are missing.";
        console.log(error);
      }
    } else if (action == "wikipedia") {
      const valuesObj = extractValues(humanInput, similarQuestion, {
        delimiters: ["{", "}"],
      });

      let { topic } = valuesObj;
      topic = capitalCase(topic);

      try {
        const wikipediaResponse = await wiki.summary(topic);
        const wikipediaResponseText = wikipediaResponse.extract;

        // Handle empty Wikipedia responses
        if (wikipediaResponseText == undefined || wikipediaResponseText == "") {
          responseText = `Sorry, I can't find any article related to "${topic}".`;
          isFallback = true;
        } else {
          responseText = wikipediaResponseText;
        }
      } catch (error) {
        responseText = `Sorry, we can't find any article related to "${topic}".`;
        console.log(error);
      }
    } else if (action == "support") {
      rating = similarQuestionRating;    // Retrieve an appropriate answer from the support chat data based on the similar question

      if (similarQuestionRating > standardRating) {
        for (let i = 0; i < supportChat.length; i++) {
          for (let j = 0; j < supportChat[i].questions.length; j++) {
            if (similarQuestion == supportChat[i].questions[j]) {
              responseText = _.sample(supportChat.answers[j]);
            }
          }
        }
      }
    }
   else if (action == "SubstationChat") {
        for (let i = 0; i < SubstationChat.length; i++) {
            for (let j = 0; j < SubstationChat[i].questions.length; j++) {
                if (similarQuestion == SubstationChat[i].questions[j]) {
                    responseText =  _.sample(SubstationChat[i].answers);
                    
                }
            }
        }
    
}

   else if (
      /(?:my name is|I'm|I am) (?!fine|good)(.{1,30})/gim.test(humanInput)    // Greet the user with their provided name
    ) {
      const humanName = /(?:my name is|I'm|I am) (.{1,30})/gim.exec(humanInput);
      responseText = `I'm glad to know, ${humanName[1]}.`;
      rating = 1;
    } else {    // Handle general chat messages and fallback responses
      action = "main_chat";

      if (similarQuestionRating > standardRating) {
        for (let i = 0; i < mainChat.length; i++) {
          for (let j = 0; j < mainChat[i].questions.length; j++) {
            if (similarQuestion == mainChat[i].questions[j]) {
              responseText = _.sample(mainChat[i].answers);
              rating = similarQuestionRating;
            }
          }
        }
      } else {
        isFallback = true;    // Fallback response for unrecognized or low-confidence queries
        action = "Default_Fallback";
        if (
          humanInput.length >= 5
          && humanInput.length <= 20
          && !/(\s{1,})/gim.test(humanInput)
        ) {
          responseText = "You are probably hitting random keys :D";
        } else {
          responseText = _.sample(fallbackChat);
        }
      }
    }

    if (responseText == null) {
      responseText = _.sample(fallbackChat);
      isFallback = true;
    } else if (action != "wikipedia") {
      responseText = responseText
        .replace(/(\[BOT_NAME\])/g, botName)
        .replace(/(\[DEVELOPER_NAME\])/g, developerName)
        .replace(/(\[DEVELOPER_EMAIL\])/g, developerEmail)
        .replace(/(\[BUG_URL\])/g, bugReportUrl);
    }

    res.json({
      responseText,
      query,
      rating,
      action,
      isFallback,
      similarQuestion,
    });
  } catch (error) {
    console.log(error);
    if (error.message.includes("URI")) {
      res.status(500).send({ error: error.message, code: 500 });
    } else {
      res.status(500).send({ error: "Internal Server Error!", code: 500 });
    }
  }
};

const notFound = async (req, res) => {
  try {
    const pageNotFoundHtml = await fs.readFileSync(
      path.join(__dirname, "public/404.html"),
      "utf8",
    );
    res.status(404).send(pageNotFoundHtml);
  } catch (err) {
    res.status(404).send("Page Not Found!");
    console.log(err);
  }
};

app.use(cors());
app.use(compression());
app.set("json spaces", 4);
app.use("/api/", morgan("tiny"));
app.get("/api/question", sendAnswer);
app.get("/api/welcome", sendWelcomeMessage);
app.get("/api/allQuestions", sendAllQuestions);
app.use(serveStatic(path.join(__dirname, "public")));
app.get("*", notFound);

app.listen(port, () => console.log(`app listening on port ${port}!`));
