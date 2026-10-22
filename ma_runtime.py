"""In-browser runtime for MeritaAnalytics notes: runs one code block, captures text, tables, charts and errors."""
import sys, io, os, json, base64, types, traceback, builtins, warnings

os.environ.setdefault("MPLBACKEND", "agg")
warnings.filterwarnings("ignore", category=DeprecationWarning)
warnings.filterwarnings("ignore", category=FutureWarning)

NS = {"__name__": "__main__"}
_out = []


class _Writer(io.TextIOBase):
    def write(self, s):
        if not s:
            return 0
        if _out and _out[-1][0] == "text":
            _out[-1][1] += s
        else:
            _out.append(["text", s])
        return len(s)

    def flush(self):
        pass


def _flush_figs():
    if "matplotlib.pyplot" not in sys.modules:
        return
    plt = sys.modules["matplotlib.pyplot"]
    for n in plt.get_fignums():
        fig = plt.figure(n)
        buf = io.BytesIO()
        fig.savefig(buf, format="png", dpi=100, bbox_inches="tight")
        _out.append(["png", base64.b64encode(buf.getvalue()).decode()])
    plt.close("all")


def _show(obj):
    if obj is None:
        return
    rh = getattr(obj, "_repr_html_", None)
    if callable(rh):
        try:
            h = rh()
            if h:
                _out.append(["html", h])
                return
        except Exception:
            pass
    rp = getattr(obj, "_repr_png_", None)
    if callable(rp):
        try:
            p = rp()
            if p:
                _out.append(["png", base64.b64encode(p).decode() if isinstance(p, bytes) else p])
                return
        except Exception:
            pass
    _Writer().write(repr(obj) + "\n")


# --- a tiny stand-in for IPython.display, which the notes use for tables and saved charts ---
class Image:
    def __init__(self, data=None, filename=None, url=None, **kw):
        if filename is None and isinstance(data, str) and os.path.exists(data):
            filename, data = data, None
        self._data = data if data is not None else open(filename, "rb").read()

    def _repr_png_(self):
        return self._data


class HTML:
    def __init__(self, data=None, **kw):
        self.data = data

    def _repr_html_(self):
        return self.data


class Markdown:
    def __init__(self, data=None, **kw):
        self.data = data

    def __repr__(self):
        return self.data


def display(*objs, **kw):
    _flush_figs()
    for o in objs:
        _show(o)


_ip = types.ModuleType("IPython")
_disp = types.ModuleType("IPython.display")
for _k, _v in dict(display=display, Image=Image, HTML=HTML, Markdown=Markdown).items():
    setattr(_disp, _k, _v)
_ip.display = _disp
_ip.get_ipython = lambda: None
_ip.version_info = (8, 0, 0)
_ip.__version__ = '8.0.0'
sys.modules["IPython"] = _ip
sys.modules["IPython.display"] = _disp
builtins.display = display


_patched = False


def _patch_numpy():
    # The browser build of NumPy is 32-bit: let repeat() accept 64-bit counts like desktop NumPy does
    global _patched
    if _patched or "numpy" not in sys.modules:
        return
    np = sys.modules["numpy"]
    _orig = np.repeat

    def repeat(a, repeats, axis=None):
        if isinstance(repeats, np.ndarray) and repeats.dtype.kind in "iu":
            repeats = repeats.astype(np.intp)
        return _orig(a, repeats, axis=axis)

    np.repeat = repeat
    _patched = True


async def run(code):
    from pyodide.code import eval_code_async
    _patch_numpy()
    _out.clear()
    old = sys.stdout, sys.stderr
    sys.stdout = sys.stderr = _Writer()
    if "matplotlib.pyplot" in sys.modules:
        sys.modules["matplotlib.pyplot"].show = lambda *a, **k: _flush_figs()
    err = None
    try:
        result = await eval_code_async(code, NS, return_mode="last_expr")
        if "matplotlib.pyplot" in sys.modules:
            sys.modules["matplotlib.pyplot"].show = lambda *a, **k: _flush_figs()
        _flush_figs()
        _show(result)
    except BaseException as e:  # noqa: BLE001 - every error is reported to the reader
        try:
            _flush_figs()
        except Exception:
            pass
        line = None
        for fr in traceback.extract_tb(e.__traceback__):
            if fr.filename == "<exec>":
                line = fr.lineno
        msg = str(e).split("\n")[0]
        err = [type(e).__name__, msg, line]
    finally:
        sys.stdout, sys.stderr = old
    return json.dumps({"out": _out, "err": err})
