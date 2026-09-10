// https://stackoverflow.com/questions/62080726/jest-allow-multi-types-for-object-structure-match
module.exports = function toBeOneOf(received, constructors = [String, Date]) {
  if (received == null) {
    return {
      message: () => `expected one of ${constructors.map((c) => c && c.name).join("|")}, got ${received}`,
      pass: false,
    };
  }
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
