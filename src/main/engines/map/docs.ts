import type { DocLink } from '../../../shared/map'

/**
 * Official documentation for languages and common libraries. Matched against
 * what the project actually imports, so Sources lists real, relevant docs with
 * no model and no web search.
 */

const LANGUAGES: Record<string, { title: string; url: string }> = {
  Python: { title: 'Python documentation', url: 'https://docs.python.org/3/' },
  JavaScript: { title: 'MDN: JavaScript', url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript' },
  TypeScript: { title: 'TypeScript Handbook', url: 'https://www.typescriptlang.org/docs/handbook/intro.html' },
  'C#': { title: 'C# documentation (Microsoft Learn)', url: 'https://learn.microsoft.com/en-us/dotnet/csharp/' },
  'C# / .NET': { title: '.NET documentation (Microsoft Learn)', url: 'https://learn.microsoft.com/en-us/dotnet/' },
  Java: { title: 'Java SE API documentation', url: 'https://docs.oracle.com/en/java/javase/21/docs/api/' },
  Kotlin: { title: 'Kotlin documentation', url: 'https://kotlinlang.org/docs/home.html' },
  Swift: { title: 'The Swift Programming Language', url: 'https://docs.swift.org/swift-book/documentation/the-swift-programming-language/' },
  'C++': { title: 'cppreference', url: 'https://en.cppreference.com/w/' },
  C: { title: 'cppreference: C', url: 'https://en.cppreference.com/w/c' },
  Go: { title: 'Go documentation', url: 'https://go.dev/doc/' },
  Rust: { title: 'The Rust Book', url: 'https://doc.rust-lang.org/book/' },
  'HTML / CSS': { title: 'MDN: HTML and CSS', url: 'https://developer.mozilla.org/en-US/docs/Web' },
  Ruby: { title: 'Ruby documentation', url: 'https://www.ruby-lang.org/en/documentation/' },
  PHP: { title: 'PHP manual', url: 'https://www.php.net/manual/en/' }
}

const LIBRARIES: Record<string, { title: string; url: string }> = {
  // Python
  numpy: { title: 'NumPy user guide', url: 'https://numpy.org/doc/stable/user/index.html' },
  pandas: { title: 'pandas user guide', url: 'https://pandas.pydata.org/docs/user_guide/index.html' },
  matplotlib: { title: 'Matplotlib: quick start', url: 'https://matplotlib.org/stable/users/explain/quick_start.html' },
  seaborn: { title: 'seaborn tutorial', url: 'https://seaborn.pydata.org/tutorial.html' },
  scipy: { title: 'SciPy user guide', url: 'https://docs.scipy.org/doc/scipy/tutorial/index.html' },
  sklearn: { title: 'scikit-learn user guide', url: 'https://scikit-learn.org/stable/user_guide.html' },
  torch: { title: 'PyTorch documentation', url: 'https://pytorch.org/docs/stable/index.html' },
  tensorflow: { title: 'TensorFlow guide', url: 'https://www.tensorflow.org/guide' },
  flask: { title: 'Flask documentation', url: 'https://flask.palletsprojects.com/' },
  django: { title: 'Django documentation', url: 'https://docs.djangoproject.com/' },
  fastapi: { title: 'FastAPI tutorial', url: 'https://fastapi.tiangolo.com/tutorial/' },
  requests: { title: 'Requests documentation', url: 'https://requests.readthedocs.io/' },
  pytest: { title: 'pytest documentation', url: 'https://docs.pytest.org/' },
  unittest: { title: 'unittest (Python docs)', url: 'https://docs.python.org/3/library/unittest.html' },
  random: { title: 'random (Python docs)', url: 'https://docs.python.org/3/library/random.html' },
  math: { title: 'math (Python docs)', url: 'https://docs.python.org/3/library/math.html' },
  json: { title: 'json (Python docs)', url: 'https://docs.python.org/3/library/json.html' },
  csv: { title: 'csv (Python docs)', url: 'https://docs.python.org/3/library/csv.html' },
  os: { title: 'os (Python docs)', url: 'https://docs.python.org/3/library/os.html' },
  pathlib: { title: 'pathlib (Python docs)', url: 'https://docs.python.org/3/library/pathlib.html' },
  collections: { title: 'collections (Python docs)', url: 'https://docs.python.org/3/library/collections.html' },
  itertools: { title: 'itertools (Python docs)', url: 'https://docs.python.org/3/library/itertools.html' },
  dataclasses: { title: 'dataclasses (Python docs)', url: 'https://docs.python.org/3/library/dataclasses.html' },
  typing: { title: 'typing (Python docs)', url: 'https://docs.python.org/3/library/typing.html' },
  abc: { title: 'abc: abstract base classes (Python docs)', url: 'https://docs.python.org/3/library/abc.html' },
  IPython: { title: 'IPython documentation', url: 'https://ipython.readthedocs.io/' },
  // JS / TS
  react: { title: 'React documentation', url: 'https://react.dev/learn' },
  express: { title: 'Express guide', url: 'https://expressjs.com/en/guide/routing.html' },
  next: { title: 'Next.js documentation', url: 'https://nextjs.org/docs' },
  vue: { title: 'Vue guide', url: 'https://vuejs.org/guide/introduction.html' },
  node: { title: 'Node.js API', url: 'https://nodejs.org/api/' },
  // Java / C#
  java: { title: 'Java SE API documentation', url: 'https://docs.oracle.com/en/java/javase/21/docs/api/' },
  javax: { title: 'Java SE API documentation', url: 'https://docs.oracle.com/en/java/javase/21/docs/api/' },
  junit: { title: 'JUnit 5 user guide', url: 'https://junit.org/junit5/docs/current/user-guide/' },
  org: { title: 'Java SE API documentation', url: 'https://docs.oracle.com/en/java/javase/21/docs/api/' },
  System: { title: '.NET API browser', url: 'https://learn.microsoft.com/en-us/dotnet/api/' },
  Microsoft: { title: 'ASP.NET Core documentation', url: 'https://learn.microsoft.com/en-us/aspnet/core/' }
}

export function stackDocs(stacks: string[], languages: string[], libraries: string[]): DocLink[] {
  const out: DocLink[] = []
  const seen = new Set<string>()
  const push = (d: { title: string; url: string }, reason: string) => {
    if (seen.has(d.url)) return
    seen.add(d.url)
    out.push({ ...d, reason, official: true })
  }
  for (const name of [...stacks, ...languages]) {
    const d = LANGUAGES[name]
    if (d) push(d, name)
  }
  for (const lib of libraries) {
    const d = LIBRARIES[lib]
    if (d) push(d, `you import ${lib}`)
  }
  return out
}
