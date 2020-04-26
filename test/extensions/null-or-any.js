expect.extend({
  nullOrAny(received, expected) {
    if (received === null) {
      return {
        pass: true,
        message: () => `expected null or instance of ${this.utils.printExpected(expected) }, but received ${ this.utils.printReceived(received) }`
      };
    }

    if (expected == String) {
      return {
        pass: typeof received == 'string' || received instanceof String,
        message: () => `expected null or instance of ${this.utils.printExpected(expected) }, but received ${ this.utils.printReceived(received) }`
      };
    }

    if (expected == Number) {
      return {
        pass: typeof received == 'number' || received instanceof Number,
        message: () => `expected null or instance of ${this.utils.printExpected(expected)}, but received ${this.utils.printReceived(received)}`
      };
    }

    if (expected == Function) {
      return {
        pass: typeof received == 'function' || received instanceof Function,
        message: () => `expected null or instance of ${this.utils.printExpected(expected)}, but received ${this.utils.printReceived(received)}`
      };
    }

    if (expected == Object) {
      return {
        pass: received !== null && typeof received == 'object',
        message: () => `expected null or instance of ${this.utils.printExpected(expected)}, but received ${this.utils.printReceived(received)}`
      };
    }

    if (expected == Boolean) {
      return {
        pass: typeof received == 'boolean',
        message: () => `expected null or instance of ${this.utils.printExpected(expected)}, but received ${this.utils.printReceived(received)}`
      };
    }

    /* jshint -W122 */
    /* global Symbol */
    if (typeof Symbol != 'undefined' && this.expectedObject == Symbol) {
      return {
        pass: typeof received == 'symbol',
        message: () => `expected null or instance of ${this.utils.printExpected(expected)}, but received ${this.utils.printReceived(received)}`
      };
    }
    /* jshint +W122 */

    return {
      pass: received instanceof expected,
      message: () => `expected null or instance of ${this.utils.printExpected(expected)}, but received ${this.utils.printReceived(received)}`
    };
  }
});
