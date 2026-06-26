/*
 * oc_fastmath — a custom PostgreSQL C extension for pg-outcry.
 *
 * Demonstrates pushing the pure-PG exchange past PL/pgSQL limits with native
 * code. oc_banker_round() does banker's rounding (round half to even) in C —
 * the engine rounds constantly during settlement/price-level math, and a C
 * scalar is far cheaper per call than the PL/pgSQL equivalent.
 *
 * Build (against this stack's nix-built PG 17.6 headers), then load by absolute
 * path (pkglibdir is the read-only nix store; /tmp is writable):
 *   gcc -shared -fPIC -I<server-include> oc_fastmath.c -o /tmp/oc_fastmath.so
 *   CREATE FUNCTION oc_banker_round(float8,int) RETURNS float8
 *     AS '/tmp/oc_fastmath.so','oc_banker_round' LANGUAGE c IMMUTABLE STRICT;
 */
#include "postgres.h"
#include "fmgr.h"
#include "utils/builtins.h"   /* cstring_to_text */
#include "utils/numeric.h"    /* numeric_round/_sub/_mul/_mod/_eq/_abs, int8_numeric */
#include <math.h>
#include <fenv.h>

PG_MODULE_MAGIC;

/* banker's rounding to `nd` decimal places (round half to even) */
PG_FUNCTION_INFO_V1(oc_banker_round);
Datum
oc_banker_round(PG_FUNCTION_ARGS)
{
    float8 x  = PG_GETARG_FLOAT8(0);
    int32  nd = PG_GETARG_INT32(1);
    double scale, y, r;

    if (nd < 0 || nd > 18)
        ereport(ERROR,
                (errcode(ERRCODE_NUMERIC_VALUE_OUT_OF_RANGE),
                 errmsg("oc_banker_round: decimals out of range: %d", nd)));

    scale = pow(10.0, (double) nd);
    y = x * scale;
    /* default FE rounding mode is round-to-nearest-even == banker's rounding */
    r = nearbyint(y);
    PG_RETURN_FLOAT8(r / scale);
}

/*
 * oc_banker_round_numeric(numeric, int) — native drop-in for the engine's
 * PL/pgSQL banker_round(). Replicates its exact half-to-even logic via the
 * server numeric API so results are bit-identical, but without the PL/pgSQL
 * interpreter overhead on the settlement hot path.
 *
 * SQL reference:
 *   retval := round(val, prec);
 *   difference := retval - val;
 *   IF abs(difference) * 10^prec = 0.5 THEN
 *     IF (retval * 10^prec) % 2 <> 0 THEN retval := round(val - difference, prec);
 *   RETURN retval;
 */
PG_FUNCTION_INFO_V1(oc_banker_round_numeric);
Datum
oc_banker_round_numeric(PG_FUNCTION_ARGS)
{
    Datum   val  = PG_GETARG_DATUM(0);
    int32   prec = PG_GETARG_INT32(1);
    Datum   retval, difference, absdiff, p10, scaled, half;
    int64   p;
    int     i;

    if (prec < 0 || prec > 18)
        ereport(ERROR,
                (errcode(ERRCODE_NUMERIC_VALUE_OUT_OF_RANGE),
                 errmsg("oc_banker_round: prec out of range: %d", prec)));

    /* retval = round(val, prec) */
    retval = DirectFunctionCall2(numeric_round, val, Int32GetDatum(prec));
    /* difference = retval - val */
    difference = DirectFunctionCall2(numeric_sub, retval, val);
    /* 10^prec as numeric (prec<=18 fits in int64) */
    p = 1;
    for (i = 0; i < prec; i++) p *= 10;
    p10 = DirectFunctionCall1(int8_numeric, Int64GetDatum(p));
    /* scaled = abs(difference) * 10^prec */
    absdiff = DirectFunctionCall1(numeric_abs, difference);
    scaled = DirectFunctionCall2(numeric_mul, absdiff, p10);
    /* half = 0.5 */
    half = DirectFunctionCall1(float8_numeric, Float8GetDatum(0.5));

    if (DatumGetBool(DirectFunctionCall2(numeric_eq, scaled, half)))
    {
        Datum two   = DirectFunctionCall1(int8_numeric, Int64GetDatum(2));
        Datum zero  = DirectFunctionCall1(int8_numeric, Int64GetDatum(0));
        Datum rscal = DirectFunctionCall2(numeric_mul, retval, p10);
        Datum mod2  = DirectFunctionCall2(numeric_mod, rscal, two);

        if (!DatumGetBool(DirectFunctionCall2(numeric_eq, mod2, zero)))
        {
            /* not even -> round the other way: round(val - difference, prec) */
            Datum other = DirectFunctionCall2(numeric_sub, val, difference);
            retval = DirectFunctionCall2(numeric_round, other, Int32GetDatum(prec));
        }
    }
    PG_RETURN_DATUM(retval);
}

/* sanity/version probe so we can confirm the extension loaded */
PG_FUNCTION_INFO_V1(oc_fastmath_version);
Datum
oc_fastmath_version(PG_FUNCTION_ARGS)
{
    PG_RETURN_TEXT_P(cstring_to_text("oc_fastmath 0.1 (native C)"));
}
