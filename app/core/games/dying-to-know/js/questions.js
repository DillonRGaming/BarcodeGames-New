/**
 * Questions.js - Question bank
 * `voice` is a pre-generated Chatterbox host clip (see ~/Documents/tts-test/cb_takes.py).
 */

const QUESTIONS = [
  {
    question: "What is the only mammal that can truly fly?",
    answers: [
      { num: 1, text: "flying squirrel" },
      { num: 2, text: "bat" },
      { num: 3, text: "sugar glider" },
      { num: 4, text: "colugo" }
    ],
    correctIndex: 2,
    time: 15,
    voice: "assets/sound/voice/q01.mp3"
  },
  {
    question: "Which planet has the most known moons?",
    answers: [
      { num: 1, text: "Saturn" },
      { num: 2, text: "Jupiter" },
      { num: 3, text: "Uranus" },
      { num: 4, text: "Neptune" }
    ],
    correctIndex: 1,
    time: 15,
    voice: "assets/sound/voice/q02.mp3"
  },
  {
    question: "How many hearts does an octopus have?",
    answers: [
      { num: 1, text: "one" },
      { num: 2, text: "two" },
      { num: 3, text: "eight" },
      { num: 4, text: "three" }
    ],
    correctIndex: 4,
    time: 15,
    voice: "assets/sound/voice/q03.mp3"
  }
];

if (typeof module !== 'undefined') module.exports = QUESTIONS;
