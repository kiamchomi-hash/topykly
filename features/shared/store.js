export class Store {
  constructor(initialState) {
    this.state = initialState;
    this.listeners = [];
    this.reducers = [];
  }

  addReducer(reducer) {
    this.reducers.push(reducer);
  }

  subscribe(listener) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  dispatch(action) {
    let newState = this.state;
    let changed = false;
    let finalResult = { changed: false };

    for (const reducer of this.reducers) {
      const result = reducer(newState, action);
      if (result.changed) {
        changed = true;
        newState = result.nextState || newState;
        finalResult = { ...result, nextState: undefined };
      }
    }

    if (changed) {
      this.state = newState;
      this.notify();
    }

    return finalResult;
  }

  notify() {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  getState() {
    return this.state;
  }
}
