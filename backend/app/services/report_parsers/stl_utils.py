"""Small dependency-free STL reader used only for factual metadata."""
import os, struct, re

def stl_metadata(path: str) -> tuple[int, tuple[float, float, float] | None]:
    size=os.path.getsize(path); raw=open(path,'rb').read()
    binary=size >= 84 and size == 84 + struct.unpack_from('<I', raw, 80)[0] * 50
    points=[]
    if binary:
        count=struct.unpack_from('<I',raw,80)[0]
        for off in range(84,84+count*50,50): points.extend(struct.unpack_from('<9f',raw,off+12))
    else:
        text=raw.decode('utf-8','ignore')
        points=[float(x) for line in re.findall(r'\bvertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)',text,re.I) for x in line]
        count=len(points)//9
    if not points: return count, None
    xs,ys,zs=points[0::3],points[1::3],points[2::3]
    return count,(max(xs)-min(xs),max(ys)-min(ys),max(zs)-min(zs))
