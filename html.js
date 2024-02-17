export function tag(tagName, attributes = {}, children = []) {
  const [name, ...classes] = tagName.split(".")
  const element = document.createElement(name)
  if (classes.length) {
    element.classList.add(...classes)
  }
  Object.entries(attributes).forEach(([attr, value]) => {
    if (attr.startsWith("on") && typeof value === "function") {
      const eventName = attr.slice(2).toLowerCase()
      element.addEventListener(eventName, value)
    } else {
      element.setAttribute(attr, value)
    }
  })
  children
    .filter((child) => child !== null && child !== undefined)
    .forEach((child) => {
      if (Array.isArray(child)) {
        child.forEach((c) => {
          element.appendChild(
            c instanceof Node ? c : document.createTextNode(c.toString()),
          )
        })
      } else {
        element.appendChild(
          child instanceof Node
            ? child
            : document.createTextNode(child.toString()),
        )
      }
    })

  return element
}

export function asyncTag(promise) {
  const placeholder = document.createElement("div")
  placeholder.textContent = "Loading..."
  promise
    .then((element) => {
      placeholder.replaceWith(element)
    })
    .catch((error) => {
      placeholder.textContent = `Error: ${error.message}`
    })
  return placeholder
}
