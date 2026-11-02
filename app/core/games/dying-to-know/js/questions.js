/**
 * Questions.js - Question bank
 * `voice` is generated from `say` (or `question`) by tools/voice/pregen.js.
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
    voice: "assets/sound/voice/q01.ogg"
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
    voice: "assets/sound/voice/q02.ogg"
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
    voice: "assets/sound/voice/q03.ogg"
  },
  {
    question: "What is the hardest natural substance on Earth?",
    answers: [
      { num: 1, text: "quartz" },
      { num: 2, text: "obsidian" },
      { num: 3, text: "diamond" },
      { num: 4, text: "granite" }
    ],
    correctIndex: 3,
    time: 15,
    voice: "assets/sound/voice/q04.ogg"
  },
  {
    question: "Which country has the most time zones?",
    answers: [
      { num: 1, text: "France" },
      { num: 2, text: "Russia" },
      { num: 3, text: "USA" },
      { num: 4, text: "China" }
    ],
    correctIndex: 1,
    time: 15,
    voice: "assets/sound/voice/q05.ogg"
  },
  {
    question: "What colour is a polar bear's skin?",
    answers: [
      { num: 1, text: "white" },
      { num: 2, text: "pink" },
      { num: 3, text: "grey" },
      { num: 4, text: "black" }
    ],
    correctIndex: 4,
    time: 15,
    voice: "assets/sound/voice/q06.ogg"
  },
  {
    question: "Which of these is NOT a dinosaur?",
    say: "Which of these is not a dinosaur?",
    answers: [
      { num: 1, text: "Stegosaurus" },
      { num: 2, text: "Megalodon" },
      { num: 3, text: "Dracorex" },
      { num: 4, text: "Triceratops" }
    ],
    correctIndex: 2,
    time: 15,
    voice: "assets/sound/voice/q07.ogg"
  },
  {
    question: "What is the most common blood type in the world?",
    answers: [
      { num: 1, text: "O positive" },
      { num: 2, text: "A positive" },
      { num: 3, text: "B negative" },
      { num: 4, text: "AB positive" }
    ],
    correctIndex: 1,
    time: 15,
    voice: "assets/sound/voice/q08.ogg"
  },
  {
    question: "What was the first toy ever advertised on TV?",
    answers: [
      { num: 1, text: "Slinky" },
      { num: 2, text: "Barbie" },
      { num: 3, text: "Mr. Potato Head" },
      { num: 4, text: "Etch A Sketch" }
    ],
    correctIndex: 3,
    time: 15,
    voice: "assets/sound/voice/q09.ogg"
  },
  {
    question: "Which city has the oldest underground railway?",
    answers: [
      { num: 1, text: "Paris" },
      { num: 2, text: "London" },
      { num: 3, text: "Budapest" },
      { num: 4, text: "New York" }
    ],
    correctIndex: 2,
    time: 15,
    voice: "assets/sound/voice/q10.ogg"
  }
];

if (typeof module !== 'undefined') module.exports = QUESTIONS;
