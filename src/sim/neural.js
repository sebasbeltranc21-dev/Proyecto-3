import { INPUTS, OUTPUTS, clamp } from './config.js';

export const NI = INPUTS.length;
export const NH = 14;
export const NO = OUTPUTS.length;
const INPUT_STRIDE = NI + 1;
const HIDDEN_STRIDE = NH + 1;
const HIDDEN_END = NH * INPUT_STRIDE;
export const GENES = HIDDEN_END + NO * HIDDEN_STRIDE;
const sigmoid = x => 1 / (1 + Math.exp(-x));

export class NeuralNetwork {
  constructor(genes) {
    this.genes = genes;
    this.hidden = new Float32Array(NH);
    this.outputs = new Float32Array(NO);
  }

  static founder(species, random) {
    const genes = Float32Array.from({ length: GENES }, () => (random() - .5) * .50);
    const hidden = (neuron, input, value) => { genes[neuron * INPUT_STRIDE + input] += value; };
    const output = (neuron, input, value) => { genes[HIDDEN_END + neuron * HIDDEN_STRIDE + input] += value; };

    // Shared starting priors. Every weight, including each bias, can mutate.
    hidden(0, 1, species ? 2.7 : 0);
    hidden(1, 4, species ? 0 : -3.3);
    hidden(2, 10, species ? 0 : 1.9);
    hidden(3, 13, 2.2);
    hidden(4, 16, species ? .18 : 1.0);
    hidden(5, 18, 2.1);
    hidden(5, 20, -2.1);
    hidden(6, 3, species ? 0 : 2.6);
    hidden(7, 0, species ? 2.1 : 0);
    hidden(8, 22, 2.4);
    hidden(8, NI, -.78);
    hidden(9, 7, .8);
    hidden(10, 24, 1.7);
    hidden(11, 19, 2);
    hidden(12, 9, species ? 0 : 2);
    hidden(13, 27, 1.25);

    output(0, NH, .28);
    output(0, 6, 1.4);
    output(0, 7, 1.0);
    output(0, 11, -1.3);
    output(0, 12, -.56);
    output(1, 0, 1.8);
    output(1, 1, 2.6);
    output(1, 2, 1.25);
    output(1, 3, 1.25);
    output(1, 4, .7);
    output(1, 5, 3);
    output(1, 9, .24);
    output(2, NH, -.5);
    output(2, 6, 1.0);
    output(2, 7, 1.65);
    output(2, 10, species ? .1 : -.8);
    output(3, NH, -1.15);
    output(3, species ? 7 : 6, 2.8);
    output(3, 13, .54);
    output(4, NH, .62);
    output(4, species ? 7 : 12, 1.55);
    output(5, NH, .38);
    output(5, 10, -.58);
    return new NeuralNetwork(genes);
  }

  run(inputs) {
    const { genes, hidden, outputs } = this;
    for (let h = 0; h < NH; h++) {
      const offset = h * INPUT_STRIDE;
      let sum = genes[offset + NI];
      for (let i = 0; i < NI; i++) sum += genes[offset + i] * inputs[i];
      hidden[h] = Math.tanh(sum);
    }
    for (let o = 0; o < NO; o++) {
      const offset = HIDDEN_END + o * HIDDEN_STRIDE;
      let sum = genes[offset + NH];
      for (let h = 0; h < NH; h++) sum += genes[offset + h] * hidden[h];
      outputs[o] = o === 1 ? Math.tanh(sum) : sigmoid(sum);
    }
    return outputs;
  }

  static breed(first, second, random, rate = .12) {
    let mutations = 0;
    const genes = new Float32Array(GENES);
    for (let i = 0; i < GENES; i++) {
      genes[i] = random() < .5 ? first[i] : second[i];
      if (random() < rate) {
        genes[i] = clamp(genes[i] + (random() + random() + random() - 1.5) * .60, -6, 6);
        mutations++;
      }
    }
    return { brain: new NeuralNetwork(genes), mutations };
  }
}
