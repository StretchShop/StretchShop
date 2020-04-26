expect.extend({
  toBeOneOf(received, argument) {
    const validValues = Array.isArray(argument) ? argument : [argument];
    const pass = validValues.includes(received);
    if (pass) {
      return {
        message: () => (
          `expected ${received} not to be one of [${validValues.join(', ')}]`
        ),
        pass: true,
      };
    }
    return {
      message: () => (`expected ${received} to be one of [${validValues.join(', ')}]`),
      pass: false,
    };
  },
});
