import { lazy, Suspense, useState, useEffect, useRef, Fragment } from "react";
import { createPortal } from "react-dom";
import AdminLoading from "./panel/AdminLoading.jsx";
import "./hers.css";

import {
  Heart,
  Palette,
  MessageCircle,
  TrendingUp,
  ShieldCheck,
  ClipboardEdit,
  Handshake,
  Rocket,
  Gem,
  FolderKanban,
  Mail,
  User,
  X,
  KeyRound,
  Send,
  LogIn,
  Loader2,
  Lock,
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Upload,
  Image as ImageIcon,
  BarChart3,
} from "lucide-react";

import { BiWorld } from "react-icons/bi";
import { FaCamera } from "react-icons/fa";
import { FaHeartCirclePlus } from "react-icons/fa6";
import { BiHeart } from "react-icons/bi";
import { RiTeamFill } from "react-icons/ri";
import { SiOnlyfans } from "react-icons/si";
import { MdCake } from "react-icons/md";
import { AiOutlineLineChart } from "react-icons/ai";
import {
  FaWhatsapp,
  FaTelegram,
  FaInstagram,
  FaUserCircle,
} from "react-icons/fa";

import {
  supabase,
  APPLICATIONS_TABLE,
  PHOTOS_BUCKET,
  teamLogin,
  modelLogin,
} from "./lib/supabase";
const AdminPanel = lazy(() => import("./panel/AdminPanel.jsx"));

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function HERS() {
  const [authModal, setAuthModal] = useState(null);
  const [teamPanelOpen, setTeamPanelOpen] = useState(false);
  const [adminPanelOpen, setAdminPanelOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [checkingAdminSession, setCheckingAdminSession] = useState(
    () => localStorage.getItem("hers_admin_session") === "true",
  );
  const showLanding = !checkingAdminSession && !adminPanelOpen;

  useEffect(() => {
    if (!showLanding) return;
    const revealElements = document.querySelectorAll(".reveal");
    if (!revealElements.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -50px 0px" },
    );
    revealElements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [showLanding]);

  useEffect(() => {
    if (!checkingAdminSession) return;

    const restoreAdminSession = async () => {
      const { data } = await supabase.auth.getSession();
      if (data?.session) {
        setAdminPanelOpen(true);
      } else {
        localStorage.removeItem("hers_admin_session");
      }
      setCheckingAdminSession(false);
    };
    restoreAdminSession();
  }, [checkingAdminSession]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  if (checkingAdminSession) {
    return <AdminLoading fullscreen>Restaurando sesión de administración…</AdminLoading>;
  }

  if (adminPanelOpen) {
    return (
      <Suspense fallback={<AdminLoading fullscreen>Cargando administración…</AdminLoading>}>
        <AdminPanel
          onClose={() => {
            setAdminPanelOpen(false);
            localStorage.removeItem("hers_admin_session");
          }}
        />
      </Suspense>
    );
  }

  return (
    <div className="hers-root">
      <Navbar onOpenTeam={() => setTeamPanelOpen(true)} />
      <Hero
        onJoin={() => setAuthModal("register")}
        onLogin={() => setAuthModal("login")}
      />
      <Benefits />
      <Process />
      <TeamAccessBand onOpenTeam={() => setTeamPanelOpen(true)} />
      <Stats />
      <FAQ />
      <FinalCTA onJoin={() => setAuthModal("register")} />
      <Footer />

      {authModal === "login" && (
        <ModelLoginModal
          onClose={() => setAuthModal(null)}
          onSuccess={(msg) => {
            setAuthModal(null);
            setToast(msg);
          }}
        />
      )}

      {authModal === "register" && (
        <ModelRegisterModal
          onClose={() => setAuthModal(null)}
          onSuccess={(msg) => {
            setAuthModal(null);
            setToast(msg);
          }}
        />
      )}

      {teamPanelOpen && (
        <TeamAuthModal
          onClose={() => setTeamPanelOpen(false)}
          onAdminLogin={() => {
            setTeamPanelOpen(false);
            setAdminPanelOpen(true);
            localStorage.setItem("hers_admin_session", "true");
          }}
          onChatterLogin={(msg) => {
            setTeamPanelOpen(false);
            setToast(msg);
          }}
        />
      )}

      {toast && <Toast message={toast} />}
    </div>
  );
}

function LogoMark({ className = "" }) {
  return (
    <img
      src="/HERSl.jpg"
      alt="HERS"
      width={44}
      height={44}
      className={`logo-image ${className}`}
    />
  );
}

function Navbar({ onOpenTeam }) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    let frameId = 0;

    const updateScrollUI = () => {
      frameId = 0;

      const maxScroll = Math.max(
        1,
        document.documentElement.scrollHeight - window.innerHeight,
      );
      const progress = Math.min(
        100,
        Math.max(0, (window.scrollY / maxScroll) * 100),
      );

      setScrolled(window.scrollY > 12);
      document.documentElement.style.setProperty(
        "--hers-scroll-progress",
        `${progress}%`,
      );
    };

    const onScroll = () => {
      if (frameId) return;
      frameId = window.requestAnimationFrame(updateScrollUI);
    };

    updateScrollUI();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frameId) window.cancelAnimationFrame(frameId);
      document.documentElement.style.removeProperty("--hers-scroll-progress");
    };
  }, []);

  return (
    <header className={`navbar ${scrolled ? "navbar--scrolled" : ""}`}>
      <div className="navbar__inner">
        <div className="brand">
          <LogoMark className="logo-image--50" />
        </div>
        <nav className="navbar__links">
          <a href="#beneficios">Ventajas</a>
          <a href="#proceso">Cómo funciona</a>
          <a href="#estadisticas">Indicadores</a>
          <a href="#faq">FAQ</a>
        </nav>
        <div className="navbar__actions">
          <button className="btn btn--ghost navbar__team" onClick={onOpenTeam}>
            <RiTeamFill size={17} /> Equipo
          </button>
        </div>
      </div>
    </header>
  );
}

function Hero({ onJoin, onLogin }) {
  return (
    <section className="hero">
      <div className="hero__content">
        <span className="eyebrow">
          <BiHeart size={17} /> Creator management · hecho para ti
        </span>
        <h1>
          <span>Tu contenido</span>
          <br />
          <span className="accent">Tu identidad</span>
          <br />
          <span>Tu crecimiento</span>
        </h1>
        <p className="hero__lead">
          HERS combina estrategia, marketing y gestión diaria para que puedas
          crecer sin perder el control de tu marca.{" "}
          <strong>
            Tu personalidad marca el rumbo; nosotros construimos la operación
            detrás
          </strong>
        </p>
        <div className="hero__ctas">
          <button className="btn btn--growth btn--lg" onClick={onJoin}>
            <SiOnlyfans size={20} /> Quiero crecer con HERS
          </button>
          <button className="btn btn--soft btn--lg" onClick={onLogin}>
            <LogIn size={18} /> Ya soy creadora
          </button>
        </div>
      </div>
      <div className="hero__badge">
        <div className="hero__badge-logo">
          <LogoMark className="logo-image--280" />
        </div>
        <div className="hero__assurance" aria-label="Principios de HERS">
          <span>
            <ShieldCheck size={15} /> Privacidad y discreción
          </span>
        </div>
      </div>
    </section>
  );
}

const BENEFITS_ITEMS = [
  {
    Icon: Palette,
    title: "Marca personal",
    text: "Diseñamos tu imagen, tono y contenido para que tu presencia se sienta coherente, reconocible y alineada con la identidad que quieres construir",
  },
  {
    Icon: MessageCircle,
    title: "Chatters profesionales",
    text: "Un equipo de chatters alineado con tu tono y con las reglas que definamos contigo, para mantener una experiencia coherente con tu marca",
  },
  {
    Icon: TrendingUp,
    title: "Estrategia de crecimiento",
    text: "Planes de contenido, promoción y colaboraciones para aumentar el tráfico de la cuenta y construir crecimiento de forma sostenida",
  },
  {
    Icon: ShieldCheck,
    title: "Seguridad y discreción",
    text: "Procesos claros y discreción como parte de la estrategia, con una operación pensada para que sepas qué se está haciendo y por qué",
  },
];

function useSectionVisible(ref) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { threshold: 0.2 },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);

  return visible;
}

function Benefits() {
  return (
    <section id="beneficios" className="section benefits reveal reveal--scale">
      <div className="section-intro">
        <span className="section-kicker">POR QUÉ HERS</span>
        <h2 className="section__title">
          <span>
            Una agencia que trabaja{" "}
            <span className="accent">alrededor de ti</span>
          </span>
        </h2>
        <p className="section__lead">
          No partimos de una plantilla. Definimos la estrategia según tu estilo,
          tus objetivos y los límites que quieras mantener
        </p>
      </div>
      <div className="benefits__grid">
        {BENEFITS_ITEMS.map(({ Icon, title, text }) => (
          <div className="benefit-card" key={title}>
            <div className="benefit-card__icon">
              <Icon size={26} />
            </div>
            <h3>{title}</h3>
            <p>{text}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

const PROCESS_STEPS = [
  {
    Icon: ClipboardEdit,
    title: "Aplica",
    days: "Día 1",
    text: "Completa tu perfil, háblanos de tus metas como modelo y cuéntanos tus ganas de ser parte de esta familia",
  },
  {
    Icon: Handshake,
    title: "Entrevista",
    days: "1 - 2 días",
    text: "Descubrimos tus metas y definimos la mejor estrategia basándonos en lo que nos has contado",
  },
  {
    Icon: FolderKanban,
    title: "Organización",
    days: "1 - 4 días",
    text: "Organizamos tu perfil, materiales y todo lo necesario para comenzar teniendo en cuenta tu disponibilidad como modelo",
  },
  {
    Icon: Palette,
    title: "Creación",
    days: "1 - 6 días",
    text: "Creamos tu perfil en todas las redes disponibles, filtramos contenido de marketing y elegimos un equipo de chatters",
  },
  {
    Icon: Rocket,
    title: "Marketing",
    days: "1 - 30 días",
    text: "Impulsamos tu imagen subiendo publicidad de calidad 24/7 y ajustamos la estrategia para atraer más fans a futuro",
  },
  {
    Icon: Gem,
    title: "Creces",
    text: "Revisamos resultados, buscamos nuevas estrategias, acoplamos todo y optimizamos cada semana para mantener una facturación constante",
  },
];

function Process() {
  const steps = PROCESS_STEPS;
  const [activeStep, setActiveStep] = useState(0);
  const sectionRef = useRef(null);
  const isVisible = useSectionVisible(sectionRef);

  useEffect(() => {
    if (!isVisible) return;
    const timer = setInterval(
      () => setActiveStep((current) => (current + 1) % steps.length),
      7000,
    );
    return () => clearInterval(timer);
  }, [isVisible, steps.length]);

  return (
    <section
      id="proceso"
      ref={sectionRef}
      className="section process reveal reveal--left"
    >
      <div className="process__heading">
        <span className="section-kicker">CÓMO TRABAJAMOS</span>
        <h2 className="section__title">
          <span>
            De tu primera conversación a <br />
            <span className="accent">operaciones clara</span>
          </span>
        </h2>
        <p className="section__lead">
          Un proceso pensado para conocer primero tu situación y después
          construir la estrategia
        </p>
      </div>
      <div className="process__timeline" aria-label="Evolución por etapas">
        <div className="process__timeline-line" aria-hidden="true" />
        <div
          className={`process__timeline-progress process__timeline-progress--${activeStep}`}
          aria-hidden="true"
        />
        <svg
          className="process__timeline-serpent"
          viewBox="0 0 100 170"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <linearGradient
              id="process-serpent-gradient"
              x1="0%"
              y1="0%"
              x2="100%"
              y2="0%"
            >
              <stop offset="0%" stopColor="var(--rose-300)" />
              <stop offset="55%" stopColor="var(--rose-500)" />
              <stop offset="100%" stopColor="var(--rose-600)" />
            </linearGradient>
          </defs>
          <path
            className="process__timeline-serpent-base"
            pathLength="1"
            d="M25 15 H75 V85 H25 V155 H75"
          />
          <path
            className={`process__timeline-serpent-progress process__timeline-serpent-progress--${activeStep}`}
            pathLength="1"
            d="M25 15 H75 V85 H25 V155 H75"
          />
        </svg>
        {steps.map(({ title, days }, i) => (
          <button
            type="button"
            key={title}
            className={`process__month ${activeStep === i ? "is-active" : ""}`}
            onClick={() => setActiveStep(i)}
            aria-label={`${title}: ${days}`}
          >
            <span className="process__month-dot" />
            <span className="process__month-title">{title}</span>
          </button>
        ))}
      </div>
      <div className="process__stage" aria-live="polite">
        {steps.map(({ Icon, title, days, text }, i) => (
          <article
            key={title}
            className={`process__stage-card ${activeStep === i ? "is-active" : ""}`}
            aria-hidden={activeStep !== i}
          >
            <div className="process__stage-number">
              {String(i + 1).padStart(2, "0")}
            </div>
            <div className="process__stage-icon">
              <Icon size={26} strokeWidth={1.8} />
            </div>
            <div className="process__stage-copy">
              <span className="process__stage-month">{days}</span>
              <h4>{title}</h4>
              <p>{text}</p>
            </div>
            <div className="process__stage-progress" aria-hidden="true">
              <span />
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

const revenueData = [
  { mes: "Ene", ingreso: 1500 },
  { mes: "Feb", ingreso: 2300 },
  { mes: "Mar", ingreso: 3600 },
  { mes: "Abr", ingreso: 4400 },
  { mes: "May", ingreso: 5900 },
  { mes: "Jun", ingreso: 8000 },
];

const growthData = [
  { mes: "Ene", fans: 200 },
  { mes: "Feb", fans: 1000 },
  { mes: "Mar", fans: 1600 },
  { mes: "Abr", fans: 2800 },
  { mes: "May", fans: 4200 },
  { mes: "Jun", fans: 6000 },
];

function RevenueBarChart({ data, max }) {
  return (
    <div className="hers-bars">
      {data.map((d, i) => (
        <div className="hers-bars__col" key={d.mes}>
          <span
            className="hers-bars__value"
            style={{ animationDelay: `${0.15 + i * 0.2}s` }}
          >
            ${d.ingreso.toLocaleString("es-ES")}
          </span>
          <div className="hers-bars__track">
            <div
              className="hers-bars__fill"
              style={{
                height: `${Math.max(4, (d.ingreso / max) * 100)}%`,
                animationDelay: `${i * 0.2}s`,
              }}
            />
          </div>
          <span className="hers-bars__label">{d.mes}</span>
        </div>
      ))}
    </div>
  );
}

function GrowthLineChart({ data, max }) {
  const n = data.length;
  const TOP_PAD = 16;
  const BOTTOM_PAD = 10;
  const plotRange = 100 - TOP_PAD - BOTTOM_PAD;
  const points = data.map((d, i) => ({
    x: (i / (n - 1)) * 100,
    y: 100 - BOTTOM_PAD - (d.fans / max) * plotRange,
    mes: d.mes,
    fans: d.fans,
  }));
  const polyPoints = points.map((p) => `${p.x},${p.y}`).join(" ");

  return (
    <div className="hers-line">
      <div className="hers-line__plot">
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="hers-line__svg"
        >
          {[0, 25, 50, 75, 100].map((y) => (
            <line
              key={y}
              x1="0"
              y1={y}
              x2="100"
              y2={y}
              className="hers-line__grid"
            />
          ))}
        </svg>
        <div className="hers-line__reveal">
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="hers-line__svg"
          >
            <polyline points={polyPoints} className="hers-line__path" />
          </svg>
        </div>
        {points.map((p, i) => (
          <Fragment key={i}>
            <span
              className="hers-line__value"
              style={{
                left: `${p.x}%`,
                top: `${p.y}%`,
                animationDelay: `${0.5 + i * 0.15}s`,
              }}
            >
              {p.fans.toLocaleString("es-ES")}
            </span>
            <span
              className="hers-line__dot"
              style={{
                left: `${p.x}%`,
                top: `${p.y}%`,
                animationDelay: `${0.3 + i * 0.15}s`,
              }}
              title={`${p.mes}: ${p.fans.toLocaleString("es-ES")} fans`}
            />
          </Fragment>
        ))}
      </div>
      <div className="hers-line__labels">
        {data.map((d) => (
          <span key={d.mes}>{d.mes}</span>
        ))}
      </div>
    </div>
  );
}

function CountUpValue({
  target,
  prefix = "",
  suffix = "",
  duration = 1200,
  active,
  resetKey,
}) {
  const [value, setValue] = useState(active ? 0 : target);

  useEffect(() => {
    if (!active) return;

    let start = null;
    let frame;

    const step = (timestamp) => {
      if (start === null) start = timestamp;
      const progress = Math.min((timestamp - start) / duration, 1);
      setValue(Math.round(progress * target));
      if (progress < 1) frame = requestAnimationFrame(step);
    };

    frame = requestAnimationFrame(step);
    return () => frame && cancelAnimationFrame(frame);
  }, [active, resetKey, target, duration]);

  return (
    <>
      {prefix}
      {active ? value : target}
      {suffix}
    </>
  );
}

const MODEL_REVIEWS = [
  {
    initials: "LM",
    name: "Laura M.",
    meta: "Modelo",
    text: "Lo que más valoro es sentir que hay una estrategia detrás de cada decisión. Me ayudaron a mejorar mi contenido y a tener mucha más profesionalidad",
  },
  {
    initials: "SC",
    name: "Sofía C.",
    meta: "Modelo",
    text: "Desde el principio sentí un trato cercano y profesional. Me gustó especialmente poder definir mis límites y mi estilo antes de empezar",
  },
  {
    initials: "VA",
    name: "Valentina A.",
    meta: "Modelo",
    text: "Antes hacía todo por mi cuenta y terminaba cometiendo errores. Tener una estructura, acompañamiento y una estrategia diferente cambió todo",
  },
];

function ModelReviews() {
  return (
    <div className="model-reviews">
      {MODEL_REVIEWS.map((review, index) => (
        <article
          className="model-review-card"
          key={review.name}
          style={{ "--review-delay": `${index * 120}ms` }}
        >
          <div className="model-review-card__top">
            <div className="model-review-card__avatar" aria-hidden="true">
              <img
                src="/HERSl.jpg"
                alt=""
                width={48}
                height={48}
                loading="lazy"
              />
            </div>

            <div className="model-review-card__identity">
              <strong>{review.name}</strong>
              <span>{review.meta}</span>
            </div>

            <div className="model-review-card__quote" aria-hidden="true">
              “
            </div>
          </div>

          <div className="model-review-card__stars" aria-label="5 estrellas">
            {"★★★★★".split("").map((star, starIndex) => (
              <span key={`${review.name}-${starIndex}`}>{star}</span>
            ))}
          </div>

          <p className="model-review-card__text">“{review.text}”</p>

          <div className="model-review-card__footer">
            <span className="model-review-card__line" />
            <span className="model-review-card__label">
              EXPERIENCIA DE MODELO
            </span>
          </div>
        </article>
      ))}
    </div>
  );
}

function Stats() {
  const [chartCycle, setChartCycle] = useState(0);
  const [activeChart, setActiveChart] = useState("ingreso");
  const sectionRef = useRef(null);
  const isVisible = useSectionVisible(sectionRef);

  useEffect(() => {
    if (!isVisible) return;
    const timer = setInterval(() => {
      setActiveChart((current) => (current === "ingreso" ? "fans" : "ingreso"));
      setChartCycle((current) => current + 1);
    }, 5000);
    return () => clearInterval(timer);
  }, [isVisible]);

  const highlights = [
    {
      Icon: AiOutlineLineChart,
      label: "Crecimiento mensual",
      target: 30,
      prefix: "+",
      suffix: "%",
      syncWith: "ingreso",
    },
    {
      Icon: FaHeartCirclePlus,
      label: "Retención de fans",
      target: 85,
      suffix: "%",
      syncWith: "fans",
    },
    { Icon: MessageCircle, value: "3 min", label: "Tiempo de respuesta" },
  ];

  return (
    <section
      id="estadisticas"
      ref={sectionRef}
      className="section stats reveal reveal--blur"
    >
      <span className="stats__eyebrow">
        <BarChart3 size={14} /> INDICADORES DE REFERENCIA
      </span>

      <h2 className="section__title stats__title">
        <span>
          La operación se puede medir sin
          <br />
          <span className="accent">hacer promesas</span>
        </span>
      </h2>

      <p className="stats__lead">
        Los datos mostrados son ilustrativos y no representan resultados
        públicos de modelos de HERS. Solo son resultados aproximados de nuestro
        trabajo
      </p>

      <div className="stats__grid">
        <div className="stats__panel">
          <div className="stats__panel-head">
            <div key={`title-${chartCycle}`} className="chart-fade">
              <span className="stats__mini-label">
                {activeChart === "ingreso"
                  ? "Ingresos promedio"
                  : "Crecimiento de fans"}
              </span>
            </div>
          </div>

          <div className="stats__panel-body">
            {activeChart === "ingreso" ? (
              <div key={`ingreso-${chartCycle}`} className="chart-fade">
                <RevenueBarChart data={revenueData} max={8000} />
              </div>
            ) : (
              <div key={`fans-${chartCycle}`} className="chart-fade">
                <GrowthLineChart data={growthData} max={6000} />
              </div>
            )}
          </div>
        </div>

        <div className="stats__highlights">
          {highlights.map(
            ({ Icon, value, label, target, prefix, suffix, syncWith }, i) => (
              <article
                className={`stat-highlight stat-highlight--delay-${i}`}
                key={label}
              >
                <div className="stat-highlight__icon">
                  <Icon size={18} />
                </div>
                <div className="stat-highlight__copy">
                  <strong>
                    {target != null ? (
                      <CountUpValue
                        target={target}
                        prefix={prefix}
                        suffix={suffix}
                        active={activeChart === syncWith}
                        resetKey={chartCycle}
                      />
                    ) : (
                      value
                    )}
                  </strong>
                  <span>{label}</span>
                </div>
              </article>
            ),
          )}
        </div>
      </div>

      <div>
        <div className="stats__reviews-heading">
          <span className="section-kicker">EXPERIENCIAS</span>
        </div>

        <ModelReviews />
      </div>
    </section>
  );
}

function TeamAccessBand({ onOpenTeam }) {
  return (
    <section className="team-band reveal reveal--right">
      <div className="team-band__inner">
        <div>
          <span className="team-band__eyebrow">ACCESO INTERNO</span>
          <h3>Eres administrador o chatter?</h3>
          <p>Ingresa con tu cuenta para ver tus asignaciones y métricas</p>
        </div>
        <button
          className="btn btn--primary btn--lg team-access-button"
          onClick={onOpenTeam}
        >
          <RiTeamFill size={17} /> Acceder al panel del equipo
        </button>
      </div>
    </section>
  );
}

function FAQ() {
  const questions = [
    {
      q: "Puedo mantener mis límites sobre el contenido?",
      a: "Sí. Tus límites forman parte de la conversación inicial y deben considerarse al definir la estrategia y la operación de tu cuenta",
    },
    {
      q: "Necesito experiencia previa para aplicar?",
      a: "No necesariamente. En la evaluación inicial revisamos tu situación, tus objetivos y qué tipo de apoyo necesitas para determinar si HERS encaja contigo",
    },
    {
      q: "Qué parte del trabajo realiza HERS?",
      a: "La agencia puede apoyar en estrategia, organización, marketing y gestión diaria. El alcance concreto se define según tu perfil, objetivos y necesidades",
    },
    {
      q: "Cómo funciona el primer paso?",
      a: "Completas la postulación y después podemos revisar tu situación con más detalle. La finalidad es valorar si existe un encaje real antes de avanzar",
    },
    {
      q: "Existe algun contrato? ",
      a: "Sí. Al tomar una decisión en equipo y en caso de aprobación, te enviaremos el contrato. En dicho contrato se verán reflejados los objetivos establecidos y los % de ganancias ",
    },
  ];
  const [open, setOpen] = useState(null);
  return (
    <section id="faq" className="section faq reveal">
      <div className="faq__heading">
        <span className="section-kicker">PREGUNTAS FRECUENTES</span>
        <h2 className="section__title">
          <span>
            Antes de empezar, <span className="accent">hablemos claro</span>
          </span>
        </h2>
        <p className="section__lead">
          Respuestas directas a las dudas más importantes antes de enviar tu
          postulación
        </p>
      </div>
      <div className="faq__list">
        {questions.map(({ q, a }, i) => {
          const isOpen = open === i;
          return (
            <article className={`faq__item ${isOpen ? "is-open" : ""}`} key={q}>
              <button
                type="button"
                className="faq__question"
                aria-expanded={isOpen}
                aria-controls={`faq-answer-${i}`}
                onClick={() => setOpen(isOpen ? null : i)}
              >
                <span>{q}</span>
                <ArrowRight size={18} aria-hidden="true" />
              </button>
              <div
                id={`faq-answer-${i}`}
                className={`faq__answer ${isOpen ? "is-visible" : ""}`}
                aria-hidden={!isOpen}
              >
                <div className="faq__answer-inner">
                  <p>{a}</p>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function FinalCTA({ onJoin }) {
  return (
    <section className="final-cta reveal reveal--rotate">
      <div className="final-cta__inner">
        <span className="section-kicker">TU SIGUIENTE PASO</span>
        <h2>
          <span>Construye una marca que se sienta</span>{" "}
          <span className="accent">tuya</span>
        </h2>
        <p>
          Cuéntanos dónde estás, qué quieres conseguir y qué necesitas delegar.
          A partir de ahí podemos valorar si HERS encaja contigo
        </p>
        <button className="btn btn--growth btn--lg" onClick={onJoin}>
          <SiOnlyfans size={20} /> Quiero postular
        </button>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="footer">
      <div className="footer__inner">
        <p>Agencia HERS · Todos los derechos reservados</p>
      </div>
    </footer>
  );
}

function ModalShell({ children, onClose, wide }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className={`modal-card ${wide ? "modal-card--wide" : ""}`}>
        <button
          className="modal-close"
          onClick={onClose}
          aria-label="Cerrar"
          type="button"
        >
          <X size={16} />
        </button>
        {children}
      </div>
    </div>
  );
}

function ModelLoginModal({ onClose, onSuccess }) {
  return (
    <ModalShell onClose={onClose}>
      <div className="modal-header">
        <LogoMark className="logo-image--70" />
        <h2>Iniciar sesión</h2>
        <p className="modal-subtitle">Accede a tu panel de modelo</p>
      </div>
      <ModelLoginForm onSuccess={onSuccess} />
    </ModalShell>
  );
}

function ModelLoginForm({ onSuccess }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});

  const submit = async (e) => {
    e.preventDefault();
    const nextErrors = {};
    const cleanUsername = username.trim();

    if (!cleanUsername) nextErrors.username = "El usuario es obligatorio";
    if (!password.trim()) nextErrors.password = "La contraseña es obligatoria";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    setLoading(true);
    setErrors({});

    try {
      const result = await modelLogin(cleanUsername, password);
      if (result.error) throw new Error(result.error);
      onSuccess(`Bienvenida, ${result.username || cleanUsername}`);
    } catch {
      setErrors({
        username: "Usuario incorrectos",
        password: "Contraseña incorrectos",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className="auth-form" onSubmit={submit} noValidate>
      <label>
        <span className="label-row">
          <User size={14} /> Usuario
        </span>
        <input
          type="text"
          placeholder="Usuario"
          value={username}
          autoCapitalize="none"
          autoComplete="username"
          onChange={(e) => {
            setUsername(e.target.value);
            setErrors((current) => ({
              ...current,
              username: "",
              password: "",
            }));
          }}
        />
        {errors.username && (
          <span className="field-error">
            <AlertCircle size={13} />
            {errors.username}
          </span>
        )}
      </label>
      <label>
        <span className="label-row">
          <Lock size={14} /> Contraseña
        </span>
        <input
          type="password"
          placeholder="••••••••"
          value={password}
          autoComplete="current-password"
          onChange={(e) => {
            setPassword(e.target.value);
            setErrors((current) => ({ ...current, password: "" }));
          }}
        />
        {errors.password && (
          <span className="field-error">
            <AlertCircle size={13} />
            {errors.password}
          </span>
        )}
      </label>
      <button
        className="btn btn--primary btn--full"
        type="submit"
        disabled={loading}
      >
        {loading ? (
          <>
            <Loader2 size={17} className="spin" /> Ingresando…
          </>
        ) : (
          <>
            <LogIn size={17} /> Iniciar sesión
          </>
        )}
      </button>
    </form>
  );
}

function ModelRegisterModal({ onClose, onSuccess }) {
  return (
    <ModalShell onClose={onClose} wide>
      <div className="modal-header">
        <LogoMark className="logo-image--70" />
        <h2>Regístrate como modelo</h2>
        <p className="modal-subtitle">
          Completa tu postulación para unirte a HERS
        </p>
      </div>
      <ModelRegisterForm onSuccess={onSuccess} />
    </ModalShell>
  );
}

const FOTO_KEYS = [
  "natural1",
  "natural2",
  "natural3",
  "lenceria1",
  "lenceria2",
  "lenceria3",
];

function ModelRegisterForm({ onSuccess }) {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    nombre: "",
    edad: "",
    pais: "",
    email: "",
    instagram: "",
    whatsapp: "",
    telegram: "",
    limites: "",
    estiloContenido: "",
    convivencia: "",
    tienePareja: "",
    problemaPareja: "",
    resultadosLimitantes: "",
    expectativasAporte: "",
    preferenciasFetiches: "",
  });

  const [fotos, setFotos] = useState({
    natural1: null,
    natural2: null,
    natural3: null,
    lenceria1: null,
    lenceria2: null,
    lenceria3: null,
  });

  const [previews, setPreviews] = useState({
    natural1: null,
    natural2: null,
    natural3: null,
    lenceria1: null,
    lenceria2: null,
    lenceria3: null,
  });

  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitMessage, setSubmitMessage] = useState("");

  const update = (key) => (e) => {
    setForm((current) => ({ ...current, [key]: e.target.value }));
    setErrors((current) => ({ ...current, [key]: "" }));
  };

  const handleFileChange = (key) => (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setErrors((current) => ({
        ...current,
        [key]: "El archivo debe ser una imagen",
      }));
      return;
    }

    if (file.size > 3 * 1024 * 1024) {
      setErrors((current) => ({
        ...current,
        [key]: "La imagen no debe superar los 3MB",
      }));
      return;
    }

    setFotos((current) => ({ ...current, [key]: file }));

    const reader = new FileReader();
    reader.onload = (event) =>
      setPreviews((current) => ({
        ...current,
        [key]: event.target.result,
      }));

    reader.readAsDataURL(file);
    setErrors((current) => ({ ...current, [key]: "" }));
  };

  const removeFoto = (key, inputRef) => {
    setFotos((current) => ({ ...current, [key]: null }));
    setPreviews((current) => ({ ...current, [key]: null }));
    if (inputRef.current) inputRef.current.value = "";
  };

  const validateFields = (fields) => {
    const nextErrors = {};

    fields.forEach((key) => {
      if (!String(form[key] ?? "").trim()) {
        nextErrors[key] = "Campo obligatorio";
      }
    });

    if (
      fields.includes("email") &&
      form.email.trim() &&
      !EMAIL_REGEX.test(form.email.trim())
    ) {
      nextErrors.email = "Ingresa un correo válido (ejemplo@correo.com)";
    }

    if (fields.includes("edad") && form.edad && Number(form.edad) < 18) {
      nextErrors.edad = "Debes tener 18 años o más";
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const scrollToFirstError = () => {
    requestAnimationFrame(() => {
      const firstError = document.querySelector(".auth-form .field-error");
      if (!firstError) return;
      const target =
        firstError.closest("label, .file-upload-wrapper") || firstError;
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      const input = target.querySelector("input, textarea");
      if (input && typeof input.focus === "function")
        input.focus({ preventScroll: true });
    });
  };

  const goNext = (e) => {
    e.preventDefault();

    const valid = validateFields([
      "nombre",
      "edad",
      "pais",
      "instagram",
      "whatsapp",
      "email",
    ]);
    if (!valid) {
      scrollToFirstError();
      return;
    }

    setStep(2);
  };

  const goBack = () => setStep(1);

  const validateFotos = () => {
    const missing = FOTO_KEYS.filter((key) => !fotos[key]);

    if (!missing.length) return true;

    const newErrors = {};
    missing.forEach((key) => {
      newErrors[key] = "Foto obligatoria";
    });

    setErrors((current) => ({ ...current, ...newErrors }));
    return false;
  };

  const uploadFoto = async (file, applicationId, key) => {
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const path = `${applicationId}/${key}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from(PHOTOS_BUCKET)
      .upload(path, file, {
        upsert: false,
        contentType: file.type,
      });

    if (uploadError) {
      const error = new Error(
        `No se pudo subir ${key}: ${uploadError.message}`,
      );
      error.cause = uploadError;
      throw error;
    }

    return path;
  };

  const submit = async (e) => {
    e.preventDefault();

    const secondStepFields = [
      "limites",
      "estiloContenido",
      "convivencia",
      "tienePareja",
      "problemaPareja",
      "resultadosLimitantes",
      "expectativasAporte",
      "preferenciasFetiches",
    ];

    const fieldsValid = validateFields(secondStepFields);
    const photosValid = validateFotos();
    if (!fieldsValid || !photosValid) {
      scrollToFirstError();
      return;
    }

    setLoading(true);
    setSubmitError("");
    setSubmitMessage("Estamos subiendo tus datos y fotos...");

    try {
      const applicationId =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

      const photoPaths = {};

      for (const key of FOTO_KEYS) {
        photoPaths[key] = await uploadFoto(fotos[key], applicationId, key);
      }

      setSubmitMessage("Estamos guardando tus datos...");

      const payload = {
        id: applicationId,
        nombre: form.nombre,
        edad: Number(form.edad),
        pais: form.pais,
        email: form.email,
        instagram: form.instagram,
        whatsapp: form.whatsapp,
        telegram: form.telegram || null,
        limites: form.limites,
        estilo_contenido: form.estiloContenido,
        convivencia: form.convivencia,
        tiene_pareja: form.tienePareja,
        problema_pareja: form.problemaPareja,
        resultados_limitantes: form.resultadosLimitantes,
        expectativas_aporte: form.expectativasAporte,
        preferencias_fetiches: form.preferenciasFetiches,
        foto_natural1_path: photoPaths.natural1,
        foto_natural2_path: photoPaths.natural2,
        foto_natural3_path: photoPaths.natural3,
        foto_lenceria1_path: photoPaths.lenceria1,
        foto_lenceria2_path: photoPaths.lenceria2,
        foto_lenceria3_path: photoPaths.lenceria3,
      };

      const { error: insertError } = await supabase
        .from(APPLICATIONS_TABLE)
        .insert(payload);

      if (insertError) throw insertError;

      const successMsg = `Gracias ${form.nombre || "por tu registro"}`;
      setSubmitMessage(successMsg);
      onSuccess(successMsg);
    } catch (error) {
      const message =
        error?.cause?.message || error?.message || "Error desconocido";
      setSubmitError(`No se pudo enviar la postulación. ${message}`);
      setSubmitMessage("");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form
      className="auth-form auth-form--register"
      onSubmit={step === 2 ? submit : goNext}
      noValidate
    >
      <div className="steps-indicator">
        <span className={step >= 1 ? "dot dot--active" : "dot"} />
        <span className={step >= 2 ? "dot dot--active" : "dot"} />
      </div>

      {step === 1 && (
        <>
          <div className="grid-2">
            <Field
              label={
                <>
                  <FaUserCircle size={16} /> Nombre completo
                </>
              }
              name="nombre"
              value={form.nombre}
              onChange={update("nombre")}
              placeholder="Tu nombre"
              error={errors.nombre}
            />

            <Field
              label={
                <>
                  <MdCake size={16} /> Edad
                </>
              }
              type="number"
              name="edad"
              value={form.edad}
              onChange={update("edad")}
              placeholder="18+"
              error={errors.edad}
            />
          </div>

          <div className="grid-2">
            <Field
              label={
                <>
                  <BiWorld size={16} /> País
                </>
              }
              name="pais"
              value={form.pais}
              onChange={update("pais")}
              placeholder="País de residencia"
              error={errors.pais}
            />

            <Field
              label={
                <>
                  <FaInstagram size={16} /> Instagram
                </>
              }
              name="instagram"
              value={form.instagram}
              onChange={update("instagram")}
              placeholder="Usuario"
              error={errors.instagram}
            />
          </div>

          <div className="grid-2">
            <Field
              label={
                <>
                  <FaWhatsapp size={16} /> WhatsApp
                </>
              }
              type="tel"
              name="whatsapp"
              value={form.whatsapp}
              onChange={update("whatsapp")}
              placeholder="+ 000 000 0000"
              error={errors.whatsapp}
            />

            <Field
              label={
                <>
                  <FaTelegram size={16} /> Telegram
                </>
              }
              name="telegram"
              value={form.telegram}
              onChange={update("telegram")}
              placeholder="@usuario"
            />
          </div>
          <Field
            label={
              <>
                <Mail size={14} /> Correo electrónico
              </>
            }
            name="email"
            value={form.email}
            onChange={update("email")}
            placeholder="tucorreo@ejemplo.com"
            error={errors.email}
          />

          <button className="btn btn--growth btn--full" type="submit">
            Continuar <ArrowRight size={16} />
          </button>
        </>
      )}

      {step === 2 && (
        <>
          <p className="auth-intro photo-requirement-card">
            Estas preguntas nos ayuda a conocerte mejor. Te pedimos, por favor,
            que seas transparente y respondas todo con sinceridad — toda tu
            información es confidencial y solo la usamos para armar la mejor
            estrategia contigo
          </p>

          <TextField
            label="Qué límites tienes claros en cuanto a contenido o interacciones?"
            name="limites"
            value={form.limites}
            onChange={update("limites")}
            error={errors.limites}
          />

          <TextField
            label="Cuál es el estilo de contenido que más disfrutas hacer?"
            name="estiloContenido"
            value={form.estiloContenido}
            onChange={update("estiloContenido")}
            error={errors.estiloContenido}
          />

          <TextField
            label="Con quién vives o vives sola?"
            name="convivencia"
            value={form.convivencia}
            onChange={update("convivencia")}
            error={errors.convivencia}
          />

          <RadioGroup
            label="Tienes pareja?"
            name="tienePareja"
            value={form.tienePareja}
            onChange={update("tienePareja")}
            error={errors.tienePareja}
            options={[
              { value: "Sí", label: "Sí" },
              { value: "No", label: "No" },
            ]}
          />

          <RadioGroup
            label="En caso de tener pareja, habría algún problema con seguir creando contenido?"
            name="problemaPareja"
            value={form.problemaPareja}
            onChange={update("problemaPareja")}
            error={errors.problemaPareja}
            options={[
              { value: "Sí", label: "Sí" },
              { value: "No", label: "No" },
            ]}
          />

          <TextField
            label="Qué resultados has tenido hasta ahora y qué crees que te ha limitado?"
            name="resultadosLimitantes"
            value={form.resultadosLimitantes}
            onChange={update("resultadosLimitantes")}
            error={errors.resultadosLimitantes}
          />

          <TextField
            label="Qué esperas de trabajar con nosotros y qué puedes aportar tú?"
            name="expectativasAporte"
            value={form.expectativasAporte}
            onChange={update("expectativasAporte")}
            error={errors.expectativasAporte}
          />

          <TextField
            label="Cuéntanos tus preferencias, fetiches y cosas que puedas hacer como contenido"
            name="preferenciasFetiches"
            value={form.preferenciasFetiches}
            onChange={update("preferenciasFetiches")}
            error={errors.preferenciasFetiches}
          />

          <div className="photo-requirement">
            <p className="auth-intro photo-requirement-card">
              <strong>
                <FaCamera size={16} aria-hidden="true" /> Requisito de fotos:
              </strong>{" "}
              Necesitamos que subas <strong>6 fotos</strong> para evaluar tu
              perfil:
              <br />• <strong>3 fotos naturales</strong> (Rostro y cuerpo, sin
              maquillaje excesivo)
              <br />• <strong>3 fotos en lencería</strong> (Mostrando tu figura
              y lado mas atrevido)
              <br />
              <br />
              <em>
                Las imágenes deben ser en formato JPG o PNG y no superar los 3MB
                cada una
              </em>
            </p>
          </div>

          <div className="fotos-section">
            <h4 className="fotos-section__heading">
              <ImageIcon size={18} />
              Fotos naturales
            </h4>

            <div className="natural-photos-grid">
              {["natural1", "natural2", "natural3"].map((key) => (
                <PhotoUpload
                  key={key}
                  id={key}
                  title="Foto natural"
                  preview={previews[key]}
                  error={errors[key]}
                  onChange={handleFileChange(key)}
                  onRemove={(ref) => removeFoto(key, ref)}
                />
              ))}
            </div>

            <h4 className="fotos-section__heading fotos-section__heading--spaced">
              <ImageIcon size={18} />
              Fotos en lencería
            </h4>

            <div className="grid-3">
              {["lenceria1", "lenceria2", "lenceria3"].map((key) => (
                <PhotoUpload
                  key={key}
                  id={key}
                  title="Lencería"
                  preview={previews[key]}
                  error={errors[key]}
                  onChange={handleFileChange(key)}
                  onRemove={(ref) => removeFoto(key, ref)}
                />
              ))}
            </div>

            <div className="fotos-counter">
              <span className="fotos-counter__label">Fotos subidas:</span>
              {Object.values(fotos).filter(Boolean).length} / 6
              <span className="fotos-counter__hint">
                (3 naturales + 3 lencería)
              </span>
            </div>
          </div>

          {submitError && (
            <span className="field-error">
              <AlertCircle size={13} />
              {submitError}
            </span>
          )}

          <div className="submit-area">
            <div className="form-row-buttons">
              <button
                type="button"
                className="btn btn--outline"
                onClick={goBack}
              >
                <ArrowLeft size={16} /> Atrás
              </button>

              <button
                className="btn btn--growth"
                type="submit"
                disabled={loading}
              >
                {loading ? (
                  <>
                    <Loader2 size={17} className="spin" /> Enviando…
                  </>
                ) : (
                  <>
                    <Send size={17} /> Enviar postulación
                  </>
                )}
              </button>
            </div>
          </div>
        </>
      )}

      {loading &&
        createPortal(
          <div className="upload-loading-overlay" role="presentation">
            <div
              className="upload-status-panel"
              role="status"
              aria-live="polite"
            >
              <div className="upload-status-panel__spinner">
                <Loader2 size={22} className="spin" />
              </div>
              <div>
                <strong>Subiendo datos…</strong>
                <span>{submitMessage}</span>
                <div
                  className="upload-status-panel__progress"
                  aria-hidden="true"
                >
                  <span />
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </form>
  );
}

function Field({
  name,
  label,
  value,
  onChange,
  placeholder,
  error,
  type = "text",
}) {
  return (
    <label>
      <span className="label-row">{label}</span>

      <input
        id={name}
        name={name}
        required={!!error}
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
      />

      {error && (
        <span className="field-error">
          <AlertCircle size={13} />
          {error}
        </span>
      )}
    </label>
  );
}

function RadioGroup({ name, label, value, onChange, error, options }) {
  return (
    <fieldset className="radio-group">
      <legend className="label-row">{label}</legend>
      <div className="radio-group__options">
        {options.map((option) => (
          <label className="radio-option" key={option.value}>
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={onChange}
            />
            <span className="radio-option__circle" aria-hidden="true" />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
      {error && (
        <span className="field-error">
          <AlertCircle size={13} />
          {error}
        </span>
      )}
    </fieldset>
  );
}

function TextField({ name, label, value, onChange, error }) {
  return (
    <label>
      <span className="label-row">{label}</span>

      <textarea
        id={name}
        name={name}
        required
        rows={2}
        value={value}
        onChange={onChange}
      />

      {error && (
        <span className="field-error">
          <AlertCircle size={13} />
          {error}
        </span>
      )}
    </label>
  );
}

function PhotoUpload({ id, title, preview, error, onChange, onRemove, small }) {
  const inputRef = useRef(null);

  return (
    <div className="file-upload-wrapper">
      <label>
        <span className="label-row">{title}</span>

        <div className="file-upload-area">
          {preview ? (
            <div className="file-preview">
              <img src={preview} alt={title} />
              <button
                type="button"
                className="file-remove"
                onClick={() => onRemove(inputRef)}
              >
                <X size={14} />
              </button>
            </div>
          ) : (
            <div className="file-drop-zone">
              <Upload size={small ? 20 : 24} />
              <span>{small ? "Selecciona" : "Selecciona"}</span>
            </div>
          )}

          <input
            ref={inputRef}
            id={`file-${id}`}
            name={id}
            type="file"
            accept="image/*"
            onChange={onChange}
            className="file-upload-input"
          />

          {!preview && (
            <button
              type="button"
              className={`btn btn--outline btn--full upload-trigger-btn ${
                small ? "upload-trigger-btn--small" : ""
              }`}
              onClick={() => inputRef.current?.click()}
            >
              Subir foto
            </button>
          )}
        </div>

        {error && (
          <span className="field-error">
            <AlertCircle size={13} />
            {error}
          </span>
        )}
      </label>
    </div>
  );
}

function TeamAuthModal({ onClose, onAdminLogin, onChatterLogin }) {
  const [role, setRole] = useState("chatter");

  return (
    <ModalShell onClose={onClose}>
      <div className="modal-header">
        <LogoMark className="logo-image--70" />
        <h2>Panel de equipo</h2>
        <p className="modal-subtitle">Administradores y chatters de HERS</p>
      </div>

      <div className="role-switch">
        <button
          type="button"
          className={role === "chatter" ? "tab tab--active" : "tab"}
          onClick={() => setRole("chatter")}
        >
          <MessageCircle size={15} /> Chatter
        </button>

        <button
          type="button"
          className={role === "admin" ? "tab tab--active" : "tab"}
          onClick={() => setRole("admin")}
        >
          <FolderKanban size={15} /> Administrador
        </button>
      </div>

      {role === "admin" ? (
        <AdminLoginForm onSuccess={onAdminLogin} />
      ) : (
        <ChatterLoginForm onSuccess={onChatterLogin} />
      )}
    </ModalShell>
  );
}

function AdminLoginForm({ onSuccess }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    const { error: loginError } = await teamLogin(username, password, "admin");

    setLoading(false);

    if (loginError) {
      setError(loginError);
      return;
    }

    onSuccess();
  };

  return (
    <form className="auth-form" onSubmit={submit} noValidate>
      <label>
        <span className="label-row">
          <User size={14} /> Usuario
        </span>

        <input
          type="text"
          placeholder="Usuario"
          value={username}
          autoComplete="username"
          onChange={(e) => setUsername(e.target.value)}
        />
      </label>

      <label>
        <span className="label-row">
          <Lock size={14} /> Contraseña
        </span>

        <input
          type="password"
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>

      {error && (
        <span className="field-error">
          <AlertCircle size={13} />
          {error}
        </span>
      )}

      <button
        className="btn btn--growth btn--full"
        type="submit"
        disabled={loading}
      >
        {loading ? (
          <>
            <Loader2 size={17} className="spin" /> Verificando…
          </>
        ) : (
          <>
            <KeyRound size={17} /> Entrar al panel
          </>
        )}
      </button>
    </form>
  );
}

function ChatterLoginForm({ onSuccess }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});

  const submit = (e) => {
    e.preventDefault();

    const nextErrors = {};

    if (!username.trim()) nextErrors.username = "El usuario es obligatorio";

    if (!password.trim()) nextErrors.password = "La contraseña es obligatoria";

    setErrors(nextErrors);

    if (Object.keys(nextErrors).length) return;

    setLoading(true);
    setErrors({});

    teamLogin(username, password, "chatter")
      .then((result) => {
        if (result.error) {
          setErrors({
            username: result.error,
            password: result.error,
          });
          return;
        }

        onSuccess?.();
      })
      .catch(() => {
        setErrors({
          username: "Usuario incorrectos",
          password: "Contraseña incorrectos",
        });
      })
      .finally(() => setLoading(false));
  };

  return (
    <form className="auth-form" onSubmit={submit} noValidate>
      <label>
        <span className="label-row">
          <User size={14} /> Usuario
        </span>

        <input
          type="text"
          placeholder="Usuario"
          value={username}
          autoComplete="username"
          onChange={(e) => {
            setUsername(e.target.value);
            setErrors((c) => ({ ...c, username: "" }));
          }}
        />

        {errors.username && (
          <span className="field-error">
            <AlertCircle size={13} />
            {errors.username}
          </span>
        )}
      </label>

      <label>
        <span className="label-row">
          <Lock size={14} /> Contraseña
        </span>

        <input
          type="password"
          placeholder="••••••••"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setErrors((c) => ({ ...c, password: "" }));
          }}
        />

        {errors.password && (
          <span className="field-error">
            <AlertCircle size={13} />
            {errors.password}
          </span>
        )}
      </label>

      <button
        className="btn btn--growth btn--full"
        type="submit"
        disabled={loading}
      >
        {loading ? (
          <>
            <Loader2 size={17} className="spin" /> Verificando…
          </>
        ) : (
          <>
            <KeyRound size={17} /> Entrar al panel
          </>
        )}
      </button>
    </form>
  );
}

function Toast({ message }) {
  return (
    <div className="toast">
      <Heart size={16} />
      <span>{message}</span>
    </div>
  );
}
