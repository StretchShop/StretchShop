// https://stackoverflow.com/questions/62080726/jest-allow-multi-types-for-object-structure-match
module.exports = function toBeOneOf(received, constructors = [String, Date]) {
  const pass = !!constructors.find(c => received.constructor === c);
  if (pass) {
    return {
      message: () => `looks good`,
      pass: true,
    };
  } else {
    return {
      message: () => `not so good...`,
      pass: false,
    };
  }
};
