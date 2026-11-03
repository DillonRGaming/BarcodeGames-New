/**
 * Questions.js - Question bank
 * `voice` is a pre-generated Chatterbox host clip (see ~/Documents/tts-test/cb_takes.py).
 */

const QUESTIONS = [
  {
    question: "What was the very first product ever scanned with a barcode?",
    answers: [
      { num: 1, text: "A bunch of bananas" },
      { num: 2, text: "A can of soda" },
      { num: 3, text: "A pack of chewing gum" },
      { num: 4, text: "A box of cereal" }
    ],
    correctIndex: 3,
    time: 15,
    voice: "assets/sound/voice/q01.mp3"
  },
  {
    question: "The name LEGO comes from a Danish phrase meaning what?",
    answers: [
      { num: 1, text: "\"Build big\"" },
      { num: 2, text: "\"Little bricks\"" },
      { num: 3, text: "\"Fun for all\"" },
      { num: 4, text: "\"Play well\"" }
    ],
    correctIndex: 4,
    time: 15,
    voice: "assets/sound/voice/q02.mp3"
  },
  {
    question: "What was the first thing ever sold on eBay?",
    answers: [
      { num: 1, text: "A Beanie Baby" },
      { num: 2, text: "A broken laser pointer" },
      { num: 3, text: "A signed baseball" },
      { num: 4, text: "A used toothbrush" }
    ],
    correctIndex: 2,
    time: 15,
    voice: "assets/sound/voice/q03.mp3"
  },
  {
    question: "Velcro was invented after a man noticed what?",
    answers: [
      { num: 1, text: "Tangled fishing line" },
      { num: 2, text: "Octopus suckers" },
      { num: 3, text: "Burrs stuck in his dog's fur" },
      { num: 4, text: "A gecko on a wall" }
    ],
    correctIndex: 3,
    time: 15,
    voice: "assets/sound/voice/q04.mp3"
  },
  {
    question: "In the original Super Mario Bros., what's odd about the clouds and the bushes?",
    answers: [
      { num: 1, text: "They're made of blocks" },
      { num: 2, text: "They're the same picture" },
      { num: 3, text: "They're both animated" },
      { num: 4, text: "You can jump on both" }
    ],
    correctIndex: 2,
    time: 15,
    voice: "assets/sound/voice/q05.mp3"
  },
  {
    question: "What colour were most carrots before orange ones took over?",
    answers: [
      { num: 1, text: "Red" },
      { num: 2, text: "Black" },
      { num: 3, text: "Purple" },
      { num: 4, text: "Blue" }
    ],
    correctIndex: 3,
    time: 15,
    voice: "assets/sound/voice/q06.mp3"
  },
  {
    question: "What was Google called before it was Google?",
    answers: [
      { num: 1, text: "Googol" },
      { num: 2, text: "PageFinder" },
      { num: 3, text: "SearchMe" },
      { num: 4, text: "BackRub" }
    ],
    correctIndex: 4,
    time: 15,
    voice: "assets/sound/voice/q07.mp3"
  },
  {
    question: "Bluetooth is named after what?",
    answers: [
      { num: 1, text: "A shark" },
      { num: 2, text: "A Viking king" },
      { num: 3, text: "The first blue LED" },
      { num: 4, text: "A dentist" }
    ],
    correctIndex: 2,
    time: 15,
    voice: "assets/sound/voice/q08.mp3"
  },
  {
    question: "What was the very first thing Nintendo ever made?",
    answers: [
      { num: 1, text: "Toy robots" },
      { num: 2, text: "Vacuum cleaners" },
      { num: 3, text: "Playing cards" },
      { num: 4, text: "Instant rice" }
    ],
    correctIndex: 3,
    time: 15,
    voice: "assets/sound/voice/q09.mp3"
  },
  {
    question: "Which was invented first?",
    answers: [
      { num: 1, text: "The telephone" },
      { num: 2, text: "The typewriter" },
      { num: 3, text: "The light bulb" },
      { num: 4, text: "The fax machine" }
    ],
    correctIndex: 4,
    time: 15,
    voice: "assets/sound/voice/q10.mp3"
  }
];

if (typeof module !== 'undefined') module.exports = QUESTIONS;
