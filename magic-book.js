function shortHashOfPrompt(prompt) {
  // use a cryptographic hash function to generate a short hash of the prompt
  // we use the first 8 characters of the hash as the key
  const encoder = new TextEncoder()
  const data = encoder.encode(prompt)
  const hashBuffer = crypto.subtle.digest("SHA-256", data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  const hashHex = hashArray
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
  return hashHex.slice(0, 8)
}

async function book(prompt) {
  document.querySelectorAll("magic-book").forEach((x) => x.remove())

  const openAIEndpoint = "https://api.openai.com/v1/chat/completions"
  const response = await fetch(openAIEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${localStorage.getItem("openAI_API_Key")}`,
    },
    body: JSON.stringify({
      model: "gpt-4-0125-preview",
      max_tokens: 2048,
      messages: [
        {
          role: "system",
          content: `You are tasked with creating illustrated infodecks based on our specifications. The decks present topics in a few pages with short paragraphs, like lore from USENET or an RFC. The output should be a JSON object in the format: {"title": "On the Deep Structure of Pseudo-Terminals", "pages": [{"imageDescription": "A tree structure of abstract nodes in a technical troff typesetting layout", "paragraphs": [..., ...]}, ...]}. It's crucial that each image description is self-contained as it will be sent to the DALL-E 3 image generator. In every image description, give a complete context, as well as a consistent artistic style description.`,
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      response_format: { type: "json_object" },
    }),
  })
  const jsonResponse = await response.json()
  const bookContent = jsonResponse.choices[0].message.content
  const book = JSON.parse(bookContent)
  const hash = shortHashOfPrompt(prompt)
  localStorage.setItem(
    `book:${hash}`,
    JSON.stringify({ prompt, time: Date.now(), ...book }),
  )
  document.body.prepend(createDomElementFromJson(book, hash))
}

function createDomElementFromJson(data, hash) {
  return tag("magic-book", { id: `book:${hash}` }, [
    data.title
      ? tag("figure", { class: "cover" }, [
          tag("figcaption", {}, [data.title]),
          tag("div", {}, [
            tag("a", { href: `#book:${hash}` }, [tag("p", {}, [data.title])]),
          ]),
        ])
      : null,
    ...data.pages.map((page) => {
      return tag("figure", {}, [
        tag("figcaption", {}, [page.imageDescription]),
        tag(
          "div",
          {},
          page.paragraphs.map((p) => tag("p", {}, [p])),
        ),
      ])
    }),
  ])
}

class MagicBook extends HTMLElement {
  constructor() {
    super()
    this.apiKey = MagicBook.retrieveAPIKey()
    this.dbName = "openAICache-2"
    this.storeName = "cacheStore"
  }

  static retrieveAPIKey() {
    let key = localStorage.getItem("openAI_API_Key")
    if (!key) {
      key = prompt("Please enter your OpenAI API key:")
      localStorage.setItem("openAI_API_Key", key)
    }
    return key
  }

  connectedCallback() {
    setTimeout(() => {
      this.processContent()
    }, 100)
  }

  async processContent() {
    for (let figure of Array.from(this.querySelectorAll("figure"))) {
      let img = new Image()
      img.classList.add("generating")
      let txt = figure.querySelector("figcaption").innerText
      figure.insertAdjacentElement("afterbegin", img)
      try {
        await this.processImage(img, txt)
      } finally {
        img.classList.remove("generating")
      }

      for (let p of Array.from(figure.querySelectorAll("p")))
        await this.processSection(p)
    }
  }

  async processSection(section) {
    const text = section.innerText.trim()
    const voice = this.getAttribute("voice") || "alloy"

    if (text) {
      try {
        const blob = await this.fetchCachedData(text, () =>
          this.generateAudio(text, voice),
        )
        const audioElement = this.createAudioElement(blob)
        section.prepend(audioElement)
        section.onclick = () => audioElement.play()
        audioElement.onplay = () => section.classList.add("playing")
        audioElement.onpause = () => section.classList.remove("playing")
        audioElement.onended = () => {
          section.classList.remove("playing")
          let indexOfThisAudioElement = Array.from(
            document.querySelectorAll("audio"),
          ).indexOf(audioElement)
          let nextAudioElement =
            document.querySelectorAll("audio")[indexOfThisAudioElement + 1]
          if (nextAudioElement) {
            setTimeout(() => {
              nextAudioElement.play()
              // scroll to the containing figure
              let figure = nextAudioElement.closest("figure")
              figure.scrollIntoView({ behavior: "smooth" })
            })
          }
        }
      } catch (error) {
        console.error("Error creating audio element:", error)
      }
    }
  }

  async processImage(imageElement, altText) {
    if (altText) {
      try {
        const blob = await this.fetchCachedData(altText, () =>
          this.generateImage(altText),
        )
        imageElement.src = URL.createObjectURL(blob)
      } catch (error) {
        console.error("Error creating image:", error)
      }
    }
  }

  async generateImage(prompt) {
    const openAIEndpoint = "https://api.openai.com/v1/images/generations"
    const response = await this.postRequest(openAIEndpoint, {
      model: "dall-e-3",
      prompt: prompt,
      n: 1,
      size: "1024x1024",
      response_format: "b64_json",
    })

    const json = await response.json()
    const base64 = json.data[0]["b64_json"]
    return await fetch(`data:image/png;base64,${base64}`).then((res) =>
      res.blob(),
    )
  }

  async generateAudio(text, voice) {
    const openAIEndpoint = "https://api.openai.com/v1/audio/speech"
    const response = await this.postRequest(openAIEndpoint, {
      model: "tts-1",
      input: text,
      voice: voice,
      speed: 1,
    })

    return await response.blob()
  }

  async postRequest(url, body) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      throw new Error(`Error: ${response.statusText}`)
    }

    return response
  }

  createAudioElement(blob) {
    const audio = new Audio()
    audio.controls = false
    audio.src = URL.createObjectURL(blob)
    return audio
  }

  async fetchCachedData(prompt, generate) {
    return new Promise((resolve, reject) => {
      const openRequest = indexedDB.open(this.dbName, 1)

      openRequest.onupgradeneeded = (e) => {
        let db = e.target.result
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: "prompt" })
        }
      }

      openRequest.onerror = (e) => reject(e.target.errorCode)

      openRequest.onsuccess = async (e) => {
        let db = e.target.result
        const transaction = db.transaction(this.storeName, "readonly")
        const store = transaction.objectStore(this.storeName)
        const promptKey = prompt.replaceAll(/[^a-zA-Z]/g, "")
        const getRequest = store.get(promptKey)

        getRequest.onsuccess = async (e) => {
          let result = e.target.result
          if (result) {
            resolve(result.data)
          } else {
            try {
              const generatedResult = await generate()
              this.cacheData(db, promptKey, generatedResult)
              resolve(generatedResult)
            } catch (error) {
              reject(error)
            }
          }
        }
      }
    })
  }

  cacheData(db, prompt, data) {
    const transaction = db.transaction(this.storeName, "readwrite")
    const store = transaction.objectStore(this.storeName)
    store.add({ prompt: prompt, data: data })
  }

  clearData(db, prompt) {
    const transaction = db.transaction(this.storeName, "readwrite")
    const store = transaction.objectStore(this.storeName)
    store.delete(prompt)
  }
}

customElements.define("magic-book", MagicBook)

class MagicLibrary extends HTMLElement {
  constructor() {
    super()
    this.apiKey = MagicBook.retrieveAPIKey()
  }

  connectedCallback() {
    this.appendChild(
      tag(
        "form",
        {
          class: "prompt",
          onsubmit: (e) => {
            e.preventDefault() // Prevent the form from submitting
            const input = e.target.querySelector("input.prompt")
            if (input.value) {
              const prompt = input.value
              book(prompt)
            }
            return false
          },
        },
        [
          tag("input.prompt", {
            placeholder: "Enter a prompt",
            type: "text", // Ensure it's a text input
          }),
        ],
      ),
    )

    for (const [key, json] of Object.entries(localStorage)) {
      if (key.startsWith("book:")) {
        const book = JSON.parse(json)
        this.appendChild(createDomElementFromJson(book, key))
      }
    }
  }
}

function tag(tagName, attributes = {}, children = []) {
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

function asyncTag(promise) {
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

customElements.define("magic-library", MagicLibrary)
